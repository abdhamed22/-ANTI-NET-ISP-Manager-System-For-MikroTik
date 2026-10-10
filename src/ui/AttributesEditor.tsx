import { Plus, X } from 'lucide-react';
import { useI18n } from '../i18n/index.tsx';
import { RADIUS_ATTRIBUTES, type Attribute } from '../core/validate.ts';

/** Editor for User Manager RADIUS attributes ("Key:value" pairs). */
export function AttributesEditor(props: { value: Attribute[]; onChange: (v: Attribute[]) => void; error?: string | null }) {
  const { t } = useI18n();
  const set = (i: number, patch: Partial<Attribute>) => props.onChange(props.value.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  return (
    <div className={`field ${props.error ? 'has-error' : ''}`}>
      <label>{t('users.attributes')}</label>
      {props.value.map((a, i) => (
        <div className="attr-row" key={i}>
          <select className="input" value={a.key} onChange={(e) => set(i, { key: e.target.value })} dir="ltr" aria-label={t('users.attrSelect')}>
            <option value="">{t('users.attrSelect')}</option>
            {RADIUS_ATTRIBUTES.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input
            className="input"
            dir="ltr"
            value={a.value}
            disabled={!a.key}
            placeholder={t('users.attrValue')}
            onChange={(e) => set(i, { value: e.target.value })}
            autoCapitalize="off"
            spellCheck={false}
          />
          <button type="button" className="icon-btn" onClick={() => props.onChange(props.value.filter((_, j) => j !== i))} aria-label={t('c.delete')}>
            <X size={18} />
          </button>
        </div>
      ))}
      <button type="button" className="btn small ghost" onClick={() => props.onChange([...props.value, { key: '', value: '' }])}>
        <Plus size={14} /> {t('users.attrAdd')}
      </button>
      {props.error && <small className="error-text">{props.error}</small>}
    </div>
  );
}
