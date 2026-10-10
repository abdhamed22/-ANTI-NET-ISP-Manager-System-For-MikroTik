import { useEffect, useId, useState, type ReactNode } from 'react';
import { Check, Copy, Eye, EyeOff, Plus, RefreshCw, Search, TriangleAlert, X } from 'lucide-react';
import { useBackHandler } from '../app/back.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';

// ------------------------------------------------------------------ Sheet

export function Sheet(props: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
}) {
  const { t } = useI18n();
  useBackHandler(props.open, () => {
    if (!props.busy) props.onClose();
  });
  if (!props.open) return null;
  return (
    <div className="sheet-backdrop" onClick={() => !props.busy && props.onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-handle" />
        <header className="sheet-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} disabled={props.busy} aria-label={t('c.close')}>
            <X size={20} />
          </button>
        </header>
        <div className="sheet-body">{props.children}</div>
        {props.footer && <footer className="sheet-foot">{props.footer}</footer>}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Confirm dialog

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmText?: string;
  danger?: boolean;
  /** When set, the user must type this word to enable the confirm button. */
  typed?: string;
}

type ConfirmState = ConfirmOptions & { resolve: (ok: boolean) => void };
let openConfirm: ((s: ConfirmState) => void) | null = null;

/** Promise-based confirmation, e.g. `if (await confirm({...})) remove()`. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    if (!openConfirm) resolve(false);
    else openConfirm({ ...opts, resolve });
  });
}

export function ConfirmHost() {
  const { t } = useI18n();
  const [state, setState] = useState<ConfirmState | null>(null);
  const [typed, setTyped] = useState('');
  useEffect(() => {
    openConfirm = (s) => {
      setTyped('');
      setState(s);
    };
    return () => {
      openConfirm = null;
    };
  }, []);
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };
  useBackHandler(!!state, () => close(false));
  if (!state) return null;
  const blocked = !!state.typed && typed.trim() !== state.typed;
  return (
    <div className="dialog-backdrop">
      <div className="dialog" role="alertdialog" aria-modal="true">
        <h2>{state.title}</h2>
        <p>{state.message}</p>
        {state.typed && (
          <input className="input" dir="ltr" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={state.typed} autoFocus />
        )}
        <div className="dialog-actions">
          <button className="btn ghost" onClick={() => close(false)}>
            {t('c.cancel')}
          </button>
          <button className={`btn ${state.danger ? 'danger' : 'primary'}`} disabled={blocked} onClick={() => close(true)}>
            {state.confirmText ?? t('c.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Form fields

export function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: MessageKey | null;
  hint?: string;
  type?: 'text' | 'password';
  placeholder?: string;
  /** Technical values (names, IPs, rates) are always left-to-right. */
  ltr?: boolean;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'url';
  autoComplete?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  suffix?: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const [reveal, setReveal] = useState(false);
  const isPassword = props.type === 'password';
  return (
    <div className={`field ${props.error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{props.label}</label>
      <div className="input-wrap">
        {/* Technical values are LTR even in the Arabic UI; the reveal button follows the input direction. */}
        <div className={`input-box ${isPassword ? 'has-eye' : ''}`} dir={props.ltr ? 'ltr' : undefined}>
          <input
            id={id}
            className="input"
            type={isPassword && !reveal ? 'password' : 'text'}
            inputMode={props.inputMode}
            value={props.value}
            placeholder={props.placeholder}
            autoComplete={props.autoComplete ?? 'off'}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={props.disabled}
            autoFocus={props.autoFocus}
            onChange={(e) => props.onChange(e.target.value)}
          />
          {isPassword && (
            <button type="button" className="icon-btn in-input" onClick={() => setReveal((r) => !r)} aria-label={reveal ? t('c.hide') : t('c.show')}>
              {reveal ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          )}
        </div>
        {props.suffix}
      </div>
      {props.error ? <small className="error-text">{t(props.error)}</small> : props.hint ? <small className="hint">{props.hint}</small> : null}
    </div>
  );
}

export function SelectField(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  error?: MessageKey | null;
  hint?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className={`field ${props.error ? 'has-error' : ''}`}>
      <label htmlFor={id}>{props.label}</label>
      <select id={id} className="input" value={props.value} disabled={props.disabled} onChange={(e) => props.onChange(e.target.value)}>
        {props.placeholder !== undefined && <option value="">{props.placeholder}</option>}
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {props.error ? <small className="error-text">{t(props.error)}</small> : props.hint ? <small className="hint">{props.hint}</small> : null}
    </div>
  );
}

export function Toggle(props: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <label className={`toggle ${props.disabled ? 'is-disabled' : ''}`}>
      <span className="toggle-text">
        <span>{props.label}</span>
        {props.hint && <small className="hint">{props.hint}</small>}
      </span>
      <input type="checkbox" checked={props.checked} disabled={props.disabled} onChange={(e) => props.onChange(e.target.checked)} />
      <span className="toggle-ui" aria-hidden="true" />
    </label>
  );
}

export function Segmented<T extends string>(props: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div className="segmented" role="tablist">
      {props.options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={props.value === o.value}
          className={props.value === o.value ? 'on' : ''}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Lists & states

export function SearchBar(props: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useI18n();
  return (
    <div className="search">
      <Search size={18} aria-hidden="true" />
      <input
        className="input"
        type="search"
        value={props.value}
        placeholder={props.placeholder ?? t('c.search')}
        onChange={(e) => props.onChange(e.target.value)}
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
      />
      {props.value && (
        <button className="icon-btn" onClick={() => props.onChange('')} aria-label={t('c.close')}>
          <X size={16} />
        </button>
      )}
    </div>
  );
}

export function ErrorBox(props: { message: string; onRetry?: () => void }) {
  const { t } = useI18n();
  return (
    <div className="notice danger" role="alert">
      <TriangleAlert size={18} aria-hidden="true" />
      <div>
        <p>{props.message}</p>
        {props.onRetry && (
          <button className="btn small ghost" onClick={props.onRetry}>
            <RefreshCw size={14} /> {t('c.retry')}
          </button>
        )}
      </div>
    </div>
  );
}

export function Notice(props: { kind?: 'info' | 'warn' | 'danger'; children: ReactNode }) {
  return <div className={`notice ${props.kind ?? 'info'}`}>{props.children}</div>;
}

export function Empty(props: { text: string }) {
  return <p className="empty">{props.text}</p>;
}

export function Loading() {
  const { t } = useI18n();
  return (
    <div className="loading" aria-busy="true">
      <span className="spinner" /> {t('c.loading')}
    </div>
  );
}

export function Fab(props: { label: string; onClick: () => void }) {
  return (
    <button className="fab" onClick={props.onClick} aria-label={props.label}>
      <Plus size={24} />
      <span>{props.label}</span>
    </button>
  );
}

export function Badge(props: { tone: 'ok' | 'warn' | 'danger' | 'muted' | 'info'; children: ReactNode }) {
  return <span className={`badge ${props.tone}`}>{props.children}</span>;
}

export function CopyButton(props: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="icon-btn"
      aria-label={t('c.copy')}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(props.text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard can be unavailable; nothing to do */
        }
      }}
    >
      {done ? <Check size={16} /> : <Copy size={16} />}
    </button>
  );
}

export function PageHeader(props: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.subtitle && <p className="muted">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="page-actions">{props.actions}</div>}
    </div>
  );
}

export function RefreshButton(props: { onClick: () => void; busy?: boolean }) {
  const { t } = useI18n();
  return (
    <button className="icon-btn" onClick={props.onClick} disabled={props.busy} aria-label={t('c.refresh')}>
      <RefreshCw size={20} className={props.busy ? 'spin' : ''} />
    </button>
  );
}

/** Case-insensitive match of a query against several fields. */
export function matches(query: string, ...fields: Array<string | undefined>): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => (f ?? '').toLowerCase().includes(q));
}
