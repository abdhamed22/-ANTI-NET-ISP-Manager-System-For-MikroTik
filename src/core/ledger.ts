import { readJson, writeJson, type KeyValueStore } from './store.ts';

// Sales log kept on this phone. RouterOS has no place to store who sold what
// and when, so each device keeps its own log; export it to combine devices.

export type SaleKind = 'activation' | 'renewal' | 'voucher';

export interface Sale {
  id: string;
  at: string; // ISO timestamp
  user: string;
  profile: string;
  price: number;
  actor: string;
  kind: SaleKind;
}

const KEY = 'ledger.v1';

export function randomId(bytes = 8): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Local calendar day "YYYY-MM-DD" of a timestamp. */
export function localDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export class Ledger {
  private readonly kv: KeyValueStore;
  private cache: Sale[] | null = null;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(kv: KeyValueStore) {
    this.kv = kv;
  }

  async all(): Promise<Sale[]> {
    if (!this.cache) this.cache = await readJson<Sale[]>(this.kv, KEY, []);
    return this.cache;
  }

  /** Writes are serialized so two quick sales can never overwrite each other. */
  private mutate(fn: (list: Sale[]) => Sale[]): Promise<void> {
    const next = this.chain.then(async () => {
      const list = fn([...(await this.all())]);
      await writeJson(this.kv, KEY, list);
      this.cache = list;
    });
    this.chain = next.catch(() => undefined);
    return next;
  }

  record(sale: Omit<Sale, 'id' | 'at'> & { at?: string }): Promise<void> {
    const entry: Sale = { id: randomId(), at: sale.at ?? new Date().toISOString(), ...sale, price: Number(sale.price) || 0 };
    return this.mutate((list) => [entry, ...list]);
  }

  clear(): Promise<void> {
    return this.mutate(() => []);
  }

  /** Merges entries from a backup, skipping ids already present. */
  merge(entries: Sale[]): Promise<number> {
    let added = 0;
    return this.mutate((list) => {
      const ids = new Set(list.map((s) => s.id));
      const fresh = entries.filter((e) => e && typeof e.id === 'string' && !ids.has(e.id));
      added = fresh.length;
      return [...list, ...fresh].sort((a, b) => b.at.localeCompare(a.at));
    }).then(() => added);
  }
}

export function totalForDay(sales: Sale[], day: string): number {
  return sales.filter((s) => localDay(new Date(s.at)) === day).reduce((sum, s) => sum + s.price, 0);
}

/** Revenue for the last 7 local days, oldest first. */
export function lastSevenDays(sales: Sale[], now = new Date()): Array<{ day: string; date: Date; total: number }> {
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const day = localDay(d);
    out.push({ day, date: d, total: totalForDay(sales, day) });
  }
  return out;
}

/** Neutralizes spreadsheet formulas in exported text (CSV injection). */
function csvCell(value: string | number): string {
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function salesToCsv(sales: Sale[], currency: string): string {
  const header = ['date', 'user', 'profile', `price_${currency}`, 'kind', 'staff'];
  const rows = sales.map((s) => [s.at, s.user, s.profile, s.price, s.kind, s.actor].map(csvCell).join(','));
  return `﻿${[header.join(','), ...rows].join('\r\n')}\r\n`;
}
