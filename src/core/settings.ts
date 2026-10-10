import { readJson, writeJson, type KeyValueStore, type SecretStore } from './store.ts';

export type Currency = 'IQD' | 'USD' | 'EUR' | 'GBP';
export type Language = 'ar' | 'en';

export interface AppSettings {
  host: string;
  port: number;
  secure: boolean;
  /** SHA-256 of the router's HTTPS certificate, accepted by the user (trust on first use). */
  pinSha256: string;
  networkName: string;
  currency: Currency;
  /** Small data: URL image shown in the header and on voucher cards. */
  logo: string;
  language: Language;
  lastUsername: string;
  rememberPassword: boolean;
  /** Lock the app after this many minutes in the background (0 = never). */
  autoLockMinutes: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  host: '192.168.88.1',
  port: 443,
  secure: true,
  pinSha256: '',
  networkName: 'ANTI-NET',
  currency: 'IQD',
  logo: '',
  language: 'ar',
  lastUsername: '',
  rememberPassword: false,
  autoLockMinutes: 10,
};

const KEY = 'settings.v1';
const PASSWORD_KEY = 'router.password';
export const MAX_LOGO_CHARS = 300_000;

export async function loadSettings(kv: KeyValueStore): Promise<AppSettings> {
  const saved = await readJson<Partial<AppSettings>>(kv, KEY, {});
  return { ...DEFAULT_SETTINGS, ...saved };
}

export async function saveSettings(kv: KeyValueStore, s: AppSettings): Promise<void> {
  const logo = s.logo.startsWith('data:image/') && s.logo.length <= MAX_LOGO_CHARS ? s.logo : '';
  await writeJson(kv, KEY, { ...s, logo });
}

export async function loadRememberedPassword(secrets: SecretStore): Promise<string | null> {
  try {
    return await secrets.get(PASSWORD_KEY);
  } catch {
    return null;
  }
}

export async function rememberPassword(secrets: SecretStore, password: string | null): Promise<void> {
  if (password === null) await secrets.remove(PASSWORD_KEY);
  else await secrets.set(PASSWORD_KEY, password);
}

export function formatMoney(value: number, currency: Currency): string {
  const digits = currency === 'IQD' ? 0 : 2;
  const n = new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  switch (currency) {
    case 'IQD':
      return `${n} IQD`;
    case 'USD':
      return `$${n}`;
    case 'EUR':
      return `€${n}`;
    case 'GBP':
      return `£${n}`;
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function formatBits(bps: number): string {
  if (!Number.isFinite(bps) || bps <= 0) return '0 bps';
  const units = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  const i = Math.min(Math.floor(Math.log(bps) / Math.log(1000)), units.length - 1);
  return `${(bps / 1000 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
