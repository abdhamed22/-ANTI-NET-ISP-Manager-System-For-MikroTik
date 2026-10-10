const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Parses RouterOS timestamps: "2026-11-01 10:00:00" (RouterOS 7.10+) and the
 * older "nov/01/2026 10:00:00". Router time is taken as local time.
 */
export function parseRouterDate(value: string | undefined): Date | null {
  if (!value) return null;
  const v = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(v);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  m = /^([a-z]{3})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/i.exec(v);
  if (m) {
    const mon = MONTHS.indexOf(m[1].toLowerCase());
    if (mon >= 0) return new Date(+m[3], mon, +m[2], +m[4], +m[5], +m[6]);
  }
  return null;
}

export function formatDateTime(value: string | Date | undefined, locale: string): string {
  const d = value instanceof Date ? value : parseRouterDate(value) ?? (value ? new Date(value) : null);
  if (!d || Number.isNaN(d.getTime())) return typeof value === 'string' && value ? value : '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(d);
}

/** Days left until a router timestamp (negative when in the past), or null. */
export function daysLeft(value: string | undefined, now = new Date()): number | null {
  const d = parseRouterDate(value);
  if (!d) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86_400_000);
}
