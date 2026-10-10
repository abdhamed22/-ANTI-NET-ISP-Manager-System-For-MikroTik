import { RouterError, type RouterClient, type RouterRecord } from './routeros/client.ts';
import { PATHS, idOf, isActiveSubscription, type ResourceKey } from './um.ts';
import type { Sale } from './ledger.ts';
import type { Voucher } from './vouchers.ts';
import { randomId } from './ledger.ts';

export const BACKUP_APP = 'anti-net-isp-manager';
export const BACKUP_FORMAT = 2;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

/** Restore order matters: profiles before profile-limitations, users before user-profiles. */
export const RESTORE_ORDER: ResourceKey[] = ['routers', 'limitations', 'profiles', 'profileLimitations', 'users', 'userProfiles'];

/** Only these fields are written back; read-only counters and ids are never sent. */
export const WRITABLE_FIELDS: Record<ResourceKey, string[]> = {
  routers: ['name', 'address', 'shared-secret', 'coa-port', 'disabled'],
  users: ['name', 'password', 'group', 'shared-users', 'attributes', 'caller-id', 'otp-secret', 'disabled'],
  profiles: ['name', 'name-for-users', 'validity', 'price', 'starts-when', 'override-shared-users'],
  limitations: [
    'name',
    'download-limit',
    'upload-limit',
    'transfer-limit',
    'uptime-limit',
    'rate-limit-rx',
    'rate-limit-tx',
    'rate-limit-min-rx',
    'rate-limit-min-tx',
    'rate-limit-priority',
    'rate-limit-burst-rx',
    'rate-limit-burst-tx',
    'rate-limit-burst-threshold-rx',
    'rate-limit-burst-threshold-tx',
    'rate-limit-burst-time-rx',
    'rate-limit-burst-time-tx',
    'reset-counters-interval',
    'reset-counters-start-time',
  ],
  profileLimitations: ['profile', 'limitation', 'from-time', 'till-time', 'weekdays'],
  userProfiles: ['user', 'profile'],
};

export interface BackupFile {
  app: typeof BACKUP_APP;
  format: typeof BACKUP_FORMAT;
  createdAt: string;
  createdBy: string;
  router: Record<ResourceKey, RouterRecord[]>;
  local: { vouchers: Voucher[]; sales: Sale[] };
}

export async function exportBackup(
  client: RouterClient,
  vouchers: Voucher[],
  sales: Sale[],
  actor: string,
): Promise<BackupFile> {
  const router = {} as Record<ResourceKey, RouterRecord[]>;
  for (const key of RESTORE_ORDER) router[key] = await client.list(PATHS[key]);
  return { app: BACKUP_APP, format: BACKUP_FORMAT, createdAt: new Date().toISOString(), createdBy: actor, router, local: { vouchers, sales } };
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

function asRecords(value: unknown): RouterRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object' && !Array.isArray(r))
    .map((r) => {
      const out: RouterRecord = {};
      for (const [k, v] of Object.entries(r)) {
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = String(v);
      }
      return out;
    });
}

/** Converts the old Windows app's anti-net-backup.json (v1.x) to the current format. */
function fromLegacy(o: Record<string, unknown>): BackupFile {
  const legacyVouchers = Array.isArray(o.vouchers) ? (o.vouchers as Record<string, unknown>[]) : [];
  const legacySales = Array.isArray(o.transactions) ? (o.transactions as Record<string, unknown>[]) : [];
  const vouchers: Voucher[] = legacyVouchers
    .filter((v) => v && typeof v.username === 'string' && typeof v.password === 'string')
    .map((v) => ({
      id: randomId(),
      batch: 'legacy',
      username: String(v.username),
      password: String(v.password),
      profile: String(v.profile ?? ''),
      attributes: String(v.attributes ?? ''),
      status: v.status === 'Provisioned' ? 'provisioned' : 'stock',
      createdAt: String(v.created_at ?? new Date(0).toISOString()),
      provisionedAt: v.provisioned_at ? String(v.provisioned_at) : undefined,
    }));
  const sales: Sale[] = legacySales
    .filter((t) => t && typeof t.user === 'string')
    .map((t) => {
      const at = new Date(String(t.date ?? ''));
      return {
        id: `legacy-${String(t.id ?? randomId())}`,
        at: Number.isNaN(at.getTime()) ? new Date(0).toISOString() : at.toISOString(),
        user: String(t.user),
        profile: String(t.profile ?? ''),
        price: Number(t.price) || 0,
        actor: String(t.admin ?? 'legacy'),
        kind: 'activation' as const,
      };
    });
  return {
    app: BACKUP_APP,
    format: BACKUP_FORMAT,
    createdAt: new Date(0).toISOString(),
    createdBy: 'legacy',
    router: {
      routers: asRecords(o.routers),
      limitations: asRecords(o.limitations),
      profiles: asRecords(o.profiles),
      profileLimitations: asRecords(o.profile_limitations),
      users: asRecords(o.users),
      userProfiles: asRecords(o.user_profiles),
    },
    local: { vouchers, sales },
  };
}

export function parseBackup(text: string): BackupFile {
  if (text.length > MAX_BACKUP_BYTES) throw new BackupFormatError('too-large');
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch {
    throw new BackupFormatError('not-json');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new BackupFormatError('not-backup');
  const obj = o as Record<string, unknown>;
  if (obj.app === BACKUP_APP) {
    if (obj.format !== BACKUP_FORMAT) throw new BackupFormatError('unsupported-format');
    const r = (obj.router ?? {}) as Record<string, unknown>;
    const l = (obj.local ?? {}) as Record<string, unknown>;
    const router = {} as Record<ResourceKey, RouterRecord[]>;
    for (const key of RESTORE_ORDER) router[key] = asRecords(r[key]);
    return {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      createdAt: String(obj.createdAt ?? ''),
      createdBy: String(obj.createdBy ?? ''),
      router,
      local: {
        vouchers: Array.isArray(l.vouchers) ? (l.vouchers as Voucher[]) : [],
        sales: Array.isArray(l.sales) ? (l.sales as Sale[]) : [],
      },
    };
  }
  if ('users' in obj && 'profiles' in obj && ('user_profiles' in obj || 'transactions' in obj)) return fromLegacy(obj);
  throw new BackupFormatError('not-backup');
}

export function naturalKey(resource: ResourceKey, r: RouterRecord): string {
  if (resource === 'profileLimitations') {
    return [r.profile, r.limitation, r['from-time'] ?? '', r['till-time'] ?? '', r.weekdays ?? ''].join('|');
  }
  if (resource === 'userProfiles') return `${r.user}|${r.profile}`;
  return r.name ?? '';
}

export function writable(resource: ResourceKey, r: RouterRecord): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of WRITABLE_FIELDS[resource]) {
    const v = r[f];
    if (v !== undefined && v !== '') out[f] = v;
  }
  return out;
}

export interface RestoreOptions {
  /** Overwrite items that already exist (matched by name). Default: only add missing ones. */
  overwrite: boolean;
  /** Re-create running/queued subscriptions for users that have none now. Validity restarts. */
  subscriptions: boolean;
}

export interface RestoreReport {
  created: number;
  updated: number;
  skipped: number;
  failed: Array<{ resource: ResourceKey; key: string; error: string }>;
}

/**
 * Merge restore: never deletes anything on the router. Missing items are added;
 * existing ones are left alone unless `overwrite` is set.
 */
export async function restoreBackup(
  client: RouterClient,
  file: BackupFile,
  opts: RestoreOptions,
  onProgress?: (resource: ResourceKey, done: number, total: number) => void,
): Promise<RestoreReport> {
  const report: RestoreReport = { created: 0, updated: 0, skipped: 0, failed: [] };
  for (const resource of RESTORE_ORDER) {
    let items = file.router[resource] ?? [];
    if (resource === 'userProfiles') {
      if (!opts.subscriptions) {
        report.skipped += items.length;
        continue;
      }
      items = items.filter(isActiveSubscription);
    }
    const existing = await client.list(PATHS[resource]);
    const byKey = new Map(existing.map((r) => [naturalKey(resource, r), r]));
    const activeUsers = new Set(existing.filter(isActiveSubscription).map((r) => r.user));

    for (let i = 0; i < items.length; i++) {
      onProgress?.(resource, i, items.length);
      const item = items[i];
      const key = naturalKey(resource, item);
      const data = writable(resource, item);
      try {
        if (resource === 'userProfiles') {
          if (activeUsers.has(item.user)) {
            report.skipped++;
            continue;
          }
          await client.add(PATHS[resource], data);
          activeUsers.add(item.user);
          report.created++;
          continue;
        }
        const found = byKey.get(key);
        if (!found) {
          await client.add(PATHS[resource], data);
          report.created++;
        } else if (opts.overwrite && resource !== 'profileLimitations') {
          await client.set(PATHS[resource], idOf(found), data);
          report.updated++;
        } else {
          report.skipped++;
        }
      } catch (e) {
        report.failed.push({ resource, key, error: e instanceof RouterError ? e.detail || e.kind : String(e) });
      }
    }
    onProgress?.(resource, items.length, items.length);
  }
  return report;
}

/**
 * Factory reset of User Manager data (not RouterOS itself). Callers must save a
 * backup first; the UI enforces that and a typed confirmation.
 */
export async function wipeUserManager(client: RouterClient, includeRouters: boolean): Promise<void> {
  const order: ResourceKey[] = ['userProfiles', 'profileLimitations', 'users', 'profiles', 'limitations'];
  if (includeRouters) order.push('routers');
  for (const resource of order) {
    const ids = (await client.list(PATHS[resource])).map(idOf).filter(Boolean);
    // Remove in chunks so one request never carries thousands of ids.
    for (let i = 0; i < ids.length; i += 50) await client.remove(PATHS[resource], ids.slice(i, i + 50));
  }
}
