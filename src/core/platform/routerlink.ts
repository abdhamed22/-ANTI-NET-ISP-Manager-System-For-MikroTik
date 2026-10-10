import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  TransportError,
  normalizeFingerprint,
  type CertificateInfo,
  type HttpRequest,
  type HttpResponse,
  type Transport,
} from '../routeros/transport.ts';

/** Native side lives in android/app/src/main/java/net/antinet/ispmanager/RouterLinkPlugin.java */
interface RouterLinkPlugin {
  request(options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
    timeoutMs: number;
    pinSha256?: string;
  }): Promise<{ status: number; body: string }>;
  probeCertificate(options: { host: string; port: number }): Promise<CertificateInfo>;
  secureSet(options: { key: string; value: string }): Promise<void>;
  secureGet(options: { key: string }): Promise<{ value: string | null }>;
  secureRemove(options: { key: string }): Promise<void>;
}

export const RouterLink = registerPlugin<RouterLinkPlugin>('RouterLink');

export const isNative = (): boolean => Capacitor.isNativePlatform();

function toTransportError(e: unknown): TransportError {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  switch (code) {
    case 'TIMEOUT':
      return new TransportError('timeout', message);
    case 'PIN_MISMATCH':
      return new TransportError('pin-mismatch', message);
    case 'TLS':
      return new TransportError('tls', message);
    default:
      return new TransportError('network', message);
  }
}

export class NativeTransport implements Transport {
  readonly kind = 'native' as const;

  async request(req: HttpRequest): Promise<HttpResponse> {
    if (req.url.startsWith('https:') && !req.pinSha256) {
      throw new TransportError('tls', 'certificate-not-pinned');
    }
    try {
      return await RouterLink.request({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: req.body,
        timeoutMs: req.timeoutMs,
        pinSha256: req.pinSha256 ? normalizeFingerprint(req.pinSha256) : undefined,
      });
    } catch (e) {
      throw toTransportError(e);
    }
  }

  async probeCertificate(host: string, port: number): Promise<CertificateInfo> {
    try {
      const info = await RouterLink.probeCertificate({ host, port });
      return { ...info, sha256: normalizeFingerprint(info.sha256) };
    } catch (e) {
      throw toTransportError(e);
    }
  }
}

/**
 * Development-only transport for running the UI in a desktop browser. Requests
 * go to the same origin and Vite proxies /rest to the router (or the mock).
 */
export class WebDevTransport implements Transport {
  readonly kind = 'web' as const;

  async request(req: HttpRequest): Promise<HttpResponse> {
    const u = new URL(req.url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    try {
      const res = await fetch(`${u.pathname}${u.search}`, {
        method: req.method,
        headers: req.headers,
        body: req.body,
        signal: controller.signal,
        credentials: 'omit',
      });
      return { status: res.status, body: await res.text() };
    } catch (e) {
      if (controller.signal.aborted) throw new TransportError('timeout', 'timeout');
      throw new TransportError('network', e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
    }
  }

  async probeCertificate(): Promise<CertificateInfo> {
    // Browsers do not expose certificates; the dev proxy terminates TLS itself.
    return { sha256: '0'.repeat(64), subject: 'development proxy', issuer: '', validFrom: '', validTo: '' };
  }
}

export function createTransport(): Transport {
  return isNative() ? new NativeTransport() : new WebDevTransport();
}
