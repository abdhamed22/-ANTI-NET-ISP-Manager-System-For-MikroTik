import { createContext, useContext, type ReactNode } from 'react';
import { en, type MessageKey } from './en.ts';
import { ar } from './ar.ts';
import type { Language } from '../core/settings.ts';
import { RouterError } from '../core/routeros/client.ts';
import { TransportError } from '../core/routeros/transport.ts';
import { SubscriptionError } from '../core/um.ts';
import { StaffError } from '../core/staff.ts';
import { BackupFormatError } from '../core/backup.ts';

export type { MessageKey };
export type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

const DICTS: Record<Language, Record<MessageKey, string>> = { en, ar };

export function makeT(lang: Language): Translate {
  const dict = DICTS[lang];
  return (key, vars) => {
    let s = dict[key] ?? en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}

interface I18nValue {
  lang: Language;
  t: Translate;
  dir: 'rtl' | 'ltr';
  /** Locale for dates: Arabic month names with Latin digits, which staff type and read anyway. */
  locale: string;
}

const I18nContext = createContext<I18nValue>({ lang: 'en', t: makeT('en'), dir: 'ltr', locale: 'en-GB' });

export function I18nProvider({ lang, children }: { lang: Language; children: ReactNode }) {
  const value: I18nValue = {
    lang,
    t: makeT(lang),
    dir: lang === 'ar' ? 'rtl' : 'ltr',
    locale: lang === 'ar' ? 'ar-IQ-u-nu-latn' : 'en-GB',
  };
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export const useI18n = () => useContext(I18nContext);

/** Human readable, translated message for any error thrown by the core. */
export function errorMessage(t: Translate, e: unknown): string {
  if (e instanceof RouterError) {
    switch (e.kind) {
      case 'auth':
        return t('e.auth');
      case 'forbidden':
        return t('e.forbidden');
      case 'not-found':
        return t('e.notFound');
      case 'network':
        return t('e.network');
      case 'timeout':
        return t('e.timeout');
      case 'tls':
        return t('e.tls');
      case 'pin-mismatch':
        return t('e.pin');
      case 'server':
        return e.detail ? t('e.router', { detail: e.detail }) : t('e.server');
      case 'invalid-response':
        return t('e.invalid');
      case 'bad-request':
        return t('e.router', { detail: e.detail || e.kind });
    }
  }
  if (e instanceof TransportError) {
    return t(e.code === 'timeout' ? 'e.timeout' : e.code === 'tls' ? 'e.tls' : e.code === 'pin-mismatch' ? 'e.pin' : 'e.network');
  }
  if (e instanceof SubscriptionError) {
    return t(
      e.code === 'already-active'
        ? 'e.alreadyActive'
        : e.code === 'unknown-user'
          ? 'e.unknownUser'
          : e.code === 'unknown-profile'
            ? 'e.unknownProfile'
            : 'e.oldNotRemoved',
    );
  }
  if (e instanceof StaffError) return t(e.code === 'self' ? 'e.self' : 'e.lastAdmin');
  if (e instanceof BackupFormatError) return t('e.backupFile');
  return t('e.unknown', { detail: e instanceof Error ? e.message : String(e) });
}
