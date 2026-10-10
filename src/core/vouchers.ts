import { RouterError, type RouterClient } from './routeros/client.ts';
import { readJson, writeJson, type KeyValueStore } from './store.ts';
import { PATHS, idOf, profilePrice } from './um.ts';
import { randomId, type Ledger } from './ledger.ts';

// Prepaid vouchers: generated on the phone ("stock"), printed, then pushed to
// User Manager (user + subscription) when sold.

/** No 0/O, 1/l/I to avoid misreading printed cards. */
export const VOUCHER_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Cryptographically secure, unbiased random string (rejection sampling). */
export function secureRandomString(length: number, alphabet = VOUCHER_ALPHABET): string {
  const n = alphabet.length;
  const limit = 256 - (256 % n);
  let out = '';
  while (out.length < length) {
    const buf = new Uint8Array(length * 2);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit) out += alphabet[b % n];
      if (out.length === length) break;
    }
  }
  return out;
}

export type VoucherStatus = 'stock' | 'provisioned' | 'failed';

export interface Voucher {
  id: string;
  batch: string;
  username: string;
  password: string;
  profile: string;
  attributes: string;
  status: VoucherStatus;
  createdAt: string;
  provisionedAt?: string;
  error?: string;
}

export interface BatchOptions {
  quantity: number;
  profile: string;
  prefix: string;
  length: number;
  attributes: string;
}

export const VOUCHER_LIMITS = { minQty: 1, maxQty: 500, minLen: 6, maxLen: 16 } as const;

export function generateBatch(opts: BatchOptions, takenNames: Set<string>): Voucher[] {
  const qty = Math.trunc(opts.quantity);
  const len = Math.trunc(opts.length);
  if (qty < VOUCHER_LIMITS.minQty || qty > VOUCHER_LIMITS.maxQty) throw new RangeError('quantity');
  if (len < VOUCHER_LIMITS.minLen || len > VOUCHER_LIMITS.maxLen) throw new RangeError('length');
  const batch = randomId(4);
  const createdAt = new Date().toISOString();
  const used = new Set(takenNames);
  const out: Voucher[] = [];
  while (out.length < qty) {
    const username = `${opts.prefix.trim()}${secureRandomString(len)}`;
    if (used.has(username)) continue;
    used.add(username);
    out.push({
      id: randomId(),
      batch,
      username,
      password: secureRandomString(len),
      profile: opts.profile,
      attributes: opts.attributes,
      status: 'stock',
      createdAt,
    });
  }
  return out;
}

const KEY = 'vouchers.v1';

export class VoucherStore {
  private readonly kv: KeyValueStore;
  private cache: Voucher[] | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(kv: KeyValueStore) {
    this.kv = kv;
  }

  async all(): Promise<Voucher[]> {
    if (!this.cache) this.cache = await readJson<Voucher[]>(this.kv, KEY, []);
    return this.cache;
  }

  private mutate(fn: (list: Voucher[]) => Voucher[]): Promise<void> {
    const next = this.chain.then(async () => {
      const list = fn([...(await this.all())]);
      await writeJson(this.kv, KEY, list);
      this.cache = list;
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  add(vouchers: Voucher[]): Promise<void> {
    return this.mutate((list) => [...vouchers, ...list]);
  }

  update(id: string, patch: Partial<Voucher>): Promise<void> {
    return this.mutate((list) => list.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  remove(ids: string[]): Promise<void> {
    const set = new Set(ids);
    return this.mutate((list) => list.filter((v) => !set.has(v.id)));
  }

  merge(vouchers: Voucher[]): Promise<number> {
    let added = 0;
    return this.mutate((list) => {
      const names = new Set(list.map((v) => v.username));
      const fresh = vouchers.filter((v) => v && typeof v.username === 'string' && !names.has(v.username));
      added = fresh.length;
      return [...fresh, ...list];
    }).then(() => added);
  }
}

export interface ProvisionResult {
  ok: number;
  failed: Array<{ username: string; error: string }>;
}

function errorText(e: unknown): string {
  if (e instanceof RouterError) return e.detail || e.kind;
  return e instanceof Error ? e.message : String(e);
}

/**
 * Pushes stock vouchers to User Manager one by one. If the subscription cannot
 * be created the new user is removed again, so a failure never leaves a
 * half-created account behind.
 */
export async function provisionVouchers(
  client: RouterClient,
  store: VoucherStore,
  ledger: Ledger,
  ids: string[],
  actor: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ProvisionResult> {
  const all = await store.all();
  const targets = all.filter((v) => ids.includes(v.id) && v.status !== 'provisioned');
  const profiles = await client.list(PATHS.profiles);
  const result: ProvisionResult = { ok: 0, failed: [] };

  for (let i = 0; i < targets.length; i++) {
    const v = targets[i];
    onProgress?.(i, targets.length);
    let userId: string | undefined;
    try {
      const user: Record<string, string> = { name: v.username, password: v.password };
      if (v.attributes) user.attributes = v.attributes;
      userId = await client.add(PATHS.users, user);
    } catch (e) {
      await store.update(v.id, { status: 'failed', error: errorText(e) });
      result.failed.push({ username: v.username, error: errorText(e) });
      continue;
    }
    try {
      await client.add(PATHS.userProfiles, { user: v.username, profile: v.profile });
    } catch (e) {
      try {
        const id = userId ?? idOf((await client.list(PATHS.users, { name: v.username }))[0] ?? {});
        if (id) await client.remove(PATHS.users, id);
      } catch {
        /* rollback is best effort; the error below is what matters */
      }
      await store.update(v.id, { status: 'failed', error: errorText(e) });
      result.failed.push({ username: v.username, error: errorText(e) });
      continue;
    }
    await store.update(v.id, { status: 'provisioned', provisionedAt: new Date().toISOString(), error: undefined });
    await ledger.record({
      user: v.username,
      profile: v.profile,
      price: profilePrice(profiles, v.profile),
      actor,
      kind: 'voucher',
    });
    result.ok++;
  }
  onProgress?.(targets.length, targets.length);
  return result;
}
