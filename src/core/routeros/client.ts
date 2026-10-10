import { TransportError, type HttpRequest, type Transport } from './transport.ts';

export interface RouterEndpoint {
  host: string;
  port: number;
  secure: boolean;
  /** Pinned certificate fingerprint for https. */
  pinSha256?: string;
}

export interface Credentials {
  username: string;
  password: string;
}

export type RouterRecord = Record<string, string>;

export type RouterErrorKind =
  | 'auth'
  | 'forbidden'
  | 'not-found'
  | 'bad-request'
  | 'server'
  | 'network'
  | 'timeout'
  | 'tls'
  | 'pin-mismatch'
  | 'invalid-response';

export class RouterError extends Error {
  readonly kind: RouterErrorKind;
  readonly status: number;
  /** RouterOS "detail" text, e.g. "failure: already have user with this name". */
  readonly detail: string;

  constructor(kind: RouterErrorKind, status: number, detail: string) {
    super(detail || kind);
    this.name = 'RouterError';
    this.kind = kind;
    this.status = status;
    this.detail = detail;
  }
}

const PATH_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)*$/;
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_PARALLEL = 4;

export function isValidHost(host: string): boolean {
  const h = host.trim();
  if (!h || h.length > 253) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h.split('.').every((p) => Number(p) <= 255);
  if (h.includes(':')) return /^[0-9a-fA-F:]+$/.test(h) && h.split(':').length <= 8;
  return /^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(h);
}

export function baseUrl(ep: RouterEndpoint): string {
  const host = ep.host.trim();
  const hostPart = host.includes(':') ? `[${host}]` : host;
  return `${ep.secure ? 'https' : 'http'}://${hostPart}:${ep.port}/rest`;
}

function encodeBasic(user: string, pass: string): string {
  const bytes = new TextEncoder().encode(`${user}:${pass}`);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function kindForStatus(status: number): RouterErrorKind {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not-found';
  if (status >= 400 && status < 500) return 'bad-request';
  return 'server';
}

/** Small FIFO limiter so a burst of UI requests cannot flood the router. */
class Limiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}

/**
 * RouterOS v7 REST client. Reads use GET, every change uses the documented
 * POST "command word" form (/add, /set, /remove), so only GET and POST are
 * ever sent over the wire.
 */
export class RouterClient {
  readonly endpoint: RouterEndpoint;
  readonly username: string;
  private readonly transport: Transport;
  private readonly auth: string;
  private readonly limiter = new Limiter(MAX_PARALLEL);

  constructor(transport: Transport, endpoint: RouterEndpoint, creds: Credentials) {
    if (!isValidHost(endpoint.host)) throw new RouterError('bad-request', 0, 'invalid-host');
    if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) {
      throw new RouterError('bad-request', 0, 'invalid-port');
    }
    this.transport = transport;
    this.endpoint = { ...endpoint, host: endpoint.host.trim() };
    this.username = creds.username;
    this.auth = `Basic ${encodeBasic(creds.username, creds.password)}`;
  }

  async get<T = RouterRecord[]>(path: string, query?: Record<string, string>): Promise<T> {
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    return this.send<T>('GET', path, qs, undefined);
  }

  async list(path: string, query?: Record<string, string>): Promise<RouterRecord[]> {
    const data = await this.get<unknown>(path, query);
    if (Array.isArray(data)) return data as RouterRecord[];
    if (data && typeof data === 'object') return [data as RouterRecord];
    return [];
  }

  /** Adds an item and returns its .id when RouterOS reports it. */
  async add(path: string, data: Record<string, string>): Promise<string | undefined> {
    const res = await this.send<unknown>('POST', `${path}/add`, '', data);
    if (res && typeof res === 'object' && !Array.isArray(res)) {
      const r = res as Record<string, unknown>;
      const id = r.ret ?? r['.id'];
      return typeof id === 'string' ? id : undefined;
    }
    return undefined;
  }

  async set(path: string, id: string, data: Record<string, string>): Promise<void> {
    await this.send('POST', `${path}/set`, '', { ...data, '.id': id });
  }

  async remove(path: string, ids: string | string[]): Promise<void> {
    const list = Array.isArray(ids) ? ids : [ids];
    if (list.length === 0) return;
    await this.send('POST', `${path}/remove`, '', { '.id': list.join(',') });
  }

  /** Runs any other command, e.g. interface/monitor-traffic or password. */
  async command<T = unknown>(path: string, data: Record<string, string>, timeoutMs?: number): Promise<T> {
    return this.send<T>('POST', path, '', data, timeoutMs);
  }

  private async send<T>(
    method: 'GET' | 'POST',
    path: string,
    qs: string,
    body: Record<string, string> | undefined,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<T> {
    if (!PATH_RE.test(path)) throw new RouterError('bad-request', 0, `invalid-path:${path}`);
    const req: HttpRequest = {
      url: `${baseUrl(this.endpoint)}/${path}${qs}`,
      method,
      headers: {
        Authorization: this.auth,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      timeoutMs,
      pinSha256: this.endpoint.secure ? this.endpoint.pinSha256 : undefined,
    };

    let res;
    try {
      res = await this.limiter.run(() => this.transport.request(req));
    } catch (e) {
      if (e instanceof TransportError) {
        const kind: RouterErrorKind =
          e.code === 'timeout' ? 'timeout' : e.code === 'tls' ? 'tls' : e.code === 'pin-mismatch' ? 'pin-mismatch' : 'network';
        throw new RouterError(kind, 0, e.message);
      }
      throw new RouterError('network', 0, e instanceof Error ? e.message : String(e));
    }

    const text = res.body ?? '';
    let parsed: unknown = undefined;
    if (text.trim()) {
      try {
        parsed = JSON.parse(text);
      } catch {
        if (res.status >= 200 && res.status < 300) throw new RouterError('invalid-response', res.status, text.slice(0, 200));
      }
    }

    if (res.status < 200 || res.status >= 300) {
      let detail = '';
      if (parsed && typeof parsed === 'object') {
        const p = parsed as Record<string, unknown>;
        detail = String(p.detail ?? p.message ?? '');
      }
      throw new RouterError(kindForStatus(res.status), res.status, detail);
    }
    return parsed as T;
  }
}

/** RouterOS booleans arrive as "true"/"false" (older builds: "yes"/"no"). */
export function isTrue(value: string | undefined): boolean {
  const v = (value ?? '').toLowerCase();
  return v === 'true' || v === 'yes';
}
