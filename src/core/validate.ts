// Input validation shared by forms and services. Each validator returns an
// i18n message key when the value is invalid, or null when it is fine.

export type ValidationResult = string | null;

const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** RouterOS names: no whitespace, quotes, control chars; at most 64 chars. */
export function vName(value: string, required = true): ValidationResult {
  const v = value.trim();
  if (!v) return required ? 'v.required' : null;
  if (v.length > 64) return 'v.tooLong';
  if (CONTROL_RE.test(v) || /[\s"'`\\]/.test(v)) return 'v.nameChars';
  return null;
}

export function vSecret(value: string, min: number): ValidationResult {
  if (!value) return 'v.required';
  if (value.length < min) return 'v.tooShort';
  if (value.length > 128) return 'v.tooLong';
  if (CONTROL_RE.test(value)) return 'v.nameChars';
  return null;
}

/** Bit rate such as 512k, 10M, 1.5M, 1G or a plain number of bits/s. */
export function vRate(value: string, required = false): ValidationResult {
  const v = value.trim();
  if (!v) return required ? 'v.required' : null;
  return /^\d+(\.\d+)?[kKmMgG]?$/.test(v) ? null : 'v.rate';
}

/** Byte amount such as 500M, 10G or a plain number of bytes. */
export function vBytes(value: string): ValidationResult {
  const v = value.trim();
  if (!v) return null;
  return /^\d+(\.\d+)?[kKmMgGtT]?$/.test(v) ? null : 'v.bytes';
}

/** RouterOS durations: 30d, 1w2d, 12h30m, 00:30:00 or "unlimited". */
export function vDuration(value: string, required = false): ValidationResult {
  const v = value.trim();
  if (!v) return required ? 'v.required' : null;
  if (v === 'unlimited') return null;
  if (/^(\d+w)?(\d+d)?(\d+h)?(\d+m)?(\d+s)?$/.test(v) && /\d/.test(v)) return null;
  if (/^(\d+[wd])?\d{1,2}:\d{2}:\d{2}$/.test(v)) return null;
  return 'v.duration';
}

export function vTime(value: string): ValidationResult {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(value.trim());
  if (!m) return 'v.time';
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return h <= 24 && mi < 60 && s < 60 && !(h === 24 && (mi > 0 || s > 0)) ? null : 'v.time';
}

export function vPrice(value: string): ValidationResult {
  const v = value.trim();
  if (!v) return null;
  return /^\d+(\.\d{1,2})?$/.test(v) ? null : 'v.price';
}

export function vPort(value: string | number): ValidationResult {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 65535 ? null : 'v.port';
}

export function vIPv4(value: string, required = true): ValidationResult {
  const v = value.trim();
  if (!v) return required ? 'v.required' : null;
  const ok = /^\d{1,3}(\.\d{1,3}){3}$/.test(v) && v.split('.').every((p) => Number(p) <= 255);
  return ok ? null : 'v.ip';
}

/** Comma separated IPv4 addresses or networks (for staff allowed-address). */
export function vAddressList(value: string): ValidationResult {
  const v = value.trim();
  if (!v) return null;
  for (const part of v.split(',')) {
    const [ip, mask] = part.trim().split('/');
    if (vIPv4(ip) !== null) return 'v.ip';
    if (mask !== undefined && !(/^\d{1,2}$/.test(mask) && Number(mask) <= 32)) return 'v.ip';
  }
  return null;
}

export function vIntRange(value: string, min: number, max: number, required = true): ValidationResult {
  const v = value.trim();
  if (!v) return required ? 'v.required' : null;
  if (!/^\d+$/.test(v)) return 'v.number';
  const n = Number(v);
  return n >= min && n <= max ? null : 'v.range';
}

export const RADIUS_ATTRIBUTES = [
  'Acct-Interim-Interval',
  'Delegated-IPv6-Prefix',
  'Framed-IP-Address',
  'Framed-IP-Netmask',
  'Framed-IPv6-Address',
  'Framed-IPv6-Pool',
  'Framed-IPv6-Prefix',
  'Framed-Pool',
  'Idle-Timeout',
  'Mikrotik-Address-List',
  'Mikrotik-Advertise-Interval',
  'Mikrotik-Advertise-URL',
  'Mikrotik-Delegated-IPv6-Pool',
  'Mikrotik-Group',
  'Mikrotik-Host-IP',
  'Mikrotik-Mark-Id',
  'Mikrotik-Rate-Limit',
  'Mikrotik-Realm',
  'Mikrotik-Recv-Limit',
  'Mikrotik-Recv-Limit-Gigawords',
] as const;

export interface Attribute {
  key: string;
  value: string;
}

/** User Manager stores attributes as "Key:value,Key2:value2". */
export function parseAttributes(raw: string | undefined): Attribute[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => {
      const i = part.indexOf(':');
      return i === -1 ? { key: part.trim(), value: '' } : { key: part.slice(0, i).trim(), value: part.slice(i + 1).trim() };
    })
    .filter((a) => a.key);
}

export function vAttributes(attrs: Attribute[]): ValidationResult {
  for (const a of attrs) {
    if (!a.key) continue;
    if (!(RADIUS_ATTRIBUTES as readonly string[]).includes(a.key)) return 'v.attribute';
    // A comma would split the "Key:value,Key2:value2" list. Colons are fine (the key ends
    // at the first one), so IPv6 values and burst rate limits with spaces are allowed.
    if (!a.value.trim() || a.value.includes(',') || CONTROL_RE.test(a.value)) return 'v.attributeValue';
  }
  return null;
}

// ---------------------------------------------------------------- per-user speed

/** RADIUS attribute User Manager sends to the NAS to cap one subscriber's speed. */
export const RATE_ATTR = 'Mikrotik-Rate-Limit';

export interface UserSpeed {
  download: string;
  upload: string;
}

/**
 * Splits a simple Mikrotik-Rate-Limit ("rx/tx", seen from the router: rx = the
 * subscriber's upload, tx = their download) out of the attribute list. Advanced
 * values with burst settings stay in the list untouched.
 */
export function splitSpeed(attrs: Attribute[]): { speed: UserSpeed; rest: Attribute[] } {
  const i = attrs.findIndex((a) => a.key === RATE_ATTR);
  if (i === -1) return { speed: { download: '', upload: '' }, rest: attrs };
  const m = /^\s*([^\s/]+)(?:\/([^\s/]+))?\s*$/.exec(attrs[i].value);
  if (!m) return { speed: { download: '', upload: '' }, rest: attrs };
  const upload = m[1];
  const download = m[2] ?? m[1];
  return { speed: { download, upload }, rest: attrs.filter((_, j) => j !== i) };
}

/** Puts the speed back as a Mikrotik-Rate-Limit attribute (replacing any existing one). */
export function mergeSpeed(rest: Attribute[], speed: UserSpeed): Attribute[] {
  const down = speed.download.trim();
  const up = speed.upload.trim();
  if (!down && !up) return rest;
  // One value given: RouterOS applies the same rate to both directions.
  const value = `${up || down}/${down || up}`;
  return [...rest.filter((a) => a.key !== RATE_ATTR), { key: RATE_ATTR, value }];
}

/** Short "↓ 400M ↑ 400M" label for lists, or '' when the user has no own speed. */
export function speedLabel(raw: string | undefined): string {
  const { speed } = splitSpeed(parseAttributes(raw));
  if (!speed.download && !speed.upload) return '';
  return `↓ ${speed.download} ↑ ${speed.upload}`;
}

export function formatAttributes(attrs: Attribute[]): string {
  return attrs
    .filter((a) => a.key)
    .map((a) => `${a.key}:${a.value.trim()}`)
    .join(',');
}

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
