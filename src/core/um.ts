import { RouterError, isTrue, type RouterClient, type RouterRecord } from './routeros/client.ts';

/** RouterOS menus used by the app (User Manager v7 + a few system menus). */
export const PATHS = {
  routers: 'user-manager/router',
  users: 'user-manager/user',
  profiles: 'user-manager/profile',
  limitations: 'user-manager/limitation',
  profileLimitations: 'user-manager/profile-limitation',
  userProfiles: 'user-manager/user-profile',
  sessions: 'user-manager/session',
  resource: 'system/resource',
  interfaces: 'interface',
  pppActive: 'ppp/active',
  hotspotActive: 'ip/hotspot/active',
} as const;

export type ResourceKey = 'routers' | 'users' | 'profiles' | 'limitations' | 'profileLimitations' | 'userProfiles';

export const idOf = (r: RouterRecord): string => r['.id'] ?? '';

// ---------------------------------------------------------------- subscriptions

export const ACTIVE_STATES = ['running-active', 'running', 'waiting'] as const;

export function isActiveSubscription(up: RouterRecord): boolean {
  return (ACTIVE_STATES as readonly string[]).includes((up.state ?? '').toLowerCase());
}

const STATE_RANK: Record<string, number> = { 'running-active': 0, running: 1, waiting: 2, used: 3 };

/** The subscription to show for a user: the running one first, then queued, then the last used. */
export function currentSubscription(ups: RouterRecord[]): RouterRecord | undefined {
  return [...ups].sort((a, b) => {
    const ra = STATE_RANK[(a.state ?? '').toLowerCase()] ?? 9;
    const rb = STATE_RANK[(b.state ?? '').toLowerCase()] ?? 9;
    if (ra !== rb) return ra - rb;
    // RouterOS ids grow with creation order (*1, *2, *A ...); newer first.
    return parseInt(idOf(b).slice(1), 16) - parseInt(idOf(a).slice(1), 16);
  })[0];
}

export function groupByUser(ups: RouterRecord[]): Map<string, RouterRecord[]> {
  const map = new Map<string, RouterRecord[]>();
  for (const up of ups) {
    const u = up.user ?? '';
    const list = map.get(u);
    if (list) list.push(up);
    else map.set(u, [up]);
  }
  return map;
}

export function profilePrice(profiles: RouterRecord[], name: string): number {
  const p = profiles.find((x) => x.name === name);
  const n = parseFloat(p?.price ?? '');
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export class SubscriptionError extends Error {
  readonly code: 'already-active' | 'unknown-user' | 'unknown-profile' | 'old-not-removed';
  constructor(code: SubscriptionError['code']) {
    super(code);
    this.name = 'SubscriptionError';
    this.code = code;
  }
}

/** Starts a subscription. Refuses when the user already has a running or queued one. */
export async function activateSubscription(client: RouterClient, user: string, profile: string): Promise<void> {
  const [users, profiles, ups] = await Promise.all([
    client.list(PATHS.users),
    client.list(PATHS.profiles),
    client.list(PATHS.userProfiles),
  ]);
  if (!users.some((u) => u.name === user)) throw new SubscriptionError('unknown-user');
  if (!profiles.some((p) => p.name === profile)) throw new SubscriptionError('unknown-profile');
  if (ups.some((up) => up.user === user && isActiveSubscription(up))) throw new SubscriptionError('already-active');
  await client.add(PATHS.userProfiles, { user, profile });
}

/**
 * Renews a subscription. The new one is always added first so the subscriber
 * never ends up with nothing if the router rejects the request.
 *  - "queue": keep the current subscription; the new one starts after it.
 *  - "replace": remove the current running/queued subscription(s) after the new one is in.
 */
export async function renewSubscription(
  client: RouterClient,
  user: string,
  profile: string,
  mode: 'queue' | 'replace',
): Promise<void> {
  const before = (await client.list(PATHS.userProfiles)).filter((up) => up.user === user && isActiveSubscription(up));
  await client.add(PATHS.userProfiles, { user, profile });
  if (mode === 'replace' && before.length > 0) {
    try {
      await client.remove(PATHS.userProfiles, before.map(idOf));
    } catch {
      throw new SubscriptionError('old-not-removed');
    }
  }
}

// ---------------------------------------------------------------- sessions

export function sessionUser(s: RouterRecord): string {
  return s.user ?? s.username ?? s.name ?? '';
}

export function sessionAddress(s: RouterRecord): string {
  return s['user-address'] ?? s['framed-ip-address'] ?? s.address ?? s['calling-station-id'] ?? s['caller-id'] ?? '';
}

export function sessionStarted(s: RouterRecord): string {
  return s.started ?? s['start-time'] ?? s['acct-start-time'] ?? '';
}

export function sessionEnded(s: RouterRecord): string {
  return s.ended ?? s['stop-time'] ?? s['acct-stop-time'] ?? '';
}

export function sessionDownload(s: RouterRecord): number {
  return Number(s.download ?? s['bytes-out'] ?? s['tx-byte'] ?? 0) || 0;
}

export function sessionUpload(s: RouterRecord): number {
  return Number(s.upload ?? s['bytes-in'] ?? s['rx-byte'] ?? 0) || 0;
}

export function isSessionActive(s: RouterRecord): boolean {
  if ('active' in s) return isTrue(s.active);
  return !sessionEnded(s) && !s['terminate-cause'];
}

let sessionFilterWorks: boolean | null = null;

/**
 * Live sessions only. Asks the router to filter (GET ...?active=true) so a large
 * session history is not downloaded every refresh. If this RouterOS build does
 * not filter that way, falls back to the full list once and remembers it.
 */
export async function listActiveSessions(client: RouterClient): Promise<RouterRecord[]> {
  if (sessionFilterWorks !== false) {
    try {
      const rows = await client.list(PATHS.sessions, { active: 'true' });
      if (rows.length > 0) {
        sessionFilterWorks = rows.every(isSessionActive);
        if (sessionFilterWorks) return rows;
      } else if (sessionFilterWorks) {
        return rows;
      } else {
        // Empty: either nobody is online or the filter is not understood. Check once with the full list.
        // Nobody online proves nothing about the filter, so stay undecided in that case.
        const live = (await client.list(PATHS.sessions)).filter(isSessionActive);
        sessionFilterWorks = live.length === 0 ? null : false;
        return live;
      }
    } catch (e) {
      if (!(e instanceof RouterError) || e.kind !== 'bad-request') throw e;
      sessionFilterWorks = false;
    }
  }
  return (await client.list(PATHS.sessions)).filter(isSessionActive);
}

/** Test hook: forget what was learned about the router's filtering. */
export function resetSessionFilterProbe(): void {
  sessionFilterWorks = null;
}

/**
 * Disconnects a subscriber by removing their live PPP / Hotspot connection on
 * this router. (Deleting a User Manager session record only erases accounting
 * history; it does not disconnect anyone.) Returns how many connections were closed.
 */
export async function disconnectUser(client: RouterClient, user: string): Promise<number> {
  let closed = 0;
  const targets: Array<[string, Record<string, string>]> = [
    [PATHS.pppActive, { name: user }],
    [PATHS.hotspotActive, { user }],
  ];
  for (const [path, query] of targets) {
    let rows: RouterRecord[];
    try {
      rows = await client.list(path, query);
    } catch (e) {
      // Menu missing (package disabled) or not permitted: try the next one.
      if (e instanceof RouterError && ['not-found', 'bad-request', 'forbidden'].includes(e.kind)) continue;
      throw e;
    }
    const ids = rows.filter((r) => (r.name ?? r.user) === user).map(idOf).filter(Boolean);
    if (ids.length) {
      await client.remove(path, ids);
      closed += ids.length;
    }
  }
  return closed;
}

// ---------------------------------------------------------------- system

export async function fetchResource(client: RouterClient): Promise<RouterRecord> {
  const rows = await client.list(PATHS.resource);
  return rows[0] ?? {};
}

export async function listInterfaces(client: RouterClient): Promise<RouterRecord[]> {
  const rows = await client.list(PATHS.interfaces);
  return rows.filter((r) => !isTrue(r.disabled));
}

export interface TrafficSample {
  rx: number;
  tx: number;
}

export async function monitorTraffic(client: RouterClient, iface: string): Promise<TrafficSample> {
  const pick = (res: unknown): RouterRecord => {
    if (Array.isArray(res)) return (res[res.length - 1] ?? {}) as RouterRecord;
    return (res ?? {}) as RouterRecord;
  };
  let row: RouterRecord;
  try {
    row = pick(await client.command('interface/monitor-traffic', { interface: iface, once: '' }, 8000));
  } catch (e) {
    if (!(e instanceof RouterError) || e.kind !== 'bad-request') throw e;
    row = pick(await client.command('interface/monitor-traffic', { interface: iface, duration: '1s' }, 8000));
  }
  return {
    rx: Number(row['rx-bits-per-second'] ?? 0) || 0,
    tx: Number(row['tx-bits-per-second'] ?? 0) || 0,
  };
}

/** Count of subscriptions per profile, for the plans chart. */
export function planDistribution(ups: RouterRecord[]): Array<{ name: string; value: number }> {
  const dist = new Map<string, number>();
  for (const up of ups) {
    if (!isActiveSubscription(up)) continue;
    const name = up.profile || '?';
    dist.set(name, (dist.get(name) ?? 0) + 1);
  }
  return [...dist.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}
