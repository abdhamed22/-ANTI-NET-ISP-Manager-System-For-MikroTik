/** Plain key/value storage for non-secret app data (settings, voucher stock, sales log). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Storage for secrets. On Android values are encrypted with a hardware-backed Keystore key. */
export interface SecretStore extends KeyValueStore {
  readonly persistent: boolean;
}

export class MemoryStore implements KeyValueStore {
  readonly persistent = false;
  private readonly map = new Map<string, string>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string) {
    this.map.set(key, value);
  }
  async remove(key: string) {
    this.map.delete(key);
  }
}

export async function readJson<T>(kv: KeyValueStore, key: string, fallback: T): Promise<T> {
  const raw = await kv.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(kv: KeyValueStore, key: string, value: unknown): Promise<void> {
  await kv.set(key, JSON.stringify(value));
}
