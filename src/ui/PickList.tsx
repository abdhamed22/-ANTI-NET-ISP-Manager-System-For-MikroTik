import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useI18n } from '../i18n/index.tsx';
import { SearchBar, matches } from './components.tsx';

/** Searchable single-choice list; works with thousands of entries. */
export function PickList(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string; hint?: string }>;
  limit?: number;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const shown = useMemo(
    () => props.options.filter((o) => matches(q, o.label, o.hint)).slice(0, props.limit ?? 60),
    [props.options, q, props.limit],
  );
  return (
    <div className="field">
      <label>{props.label}</label>
      <SearchBar value={q} onChange={setQ} />
      <ul className="picklist" role="listbox" aria-label={props.label}>
        {shown.map((o) => (
          <li key={o.value}>
            <button type="button" role="option" aria-selected={props.value === o.value} className={props.value === o.value ? 'on' : ''} onClick={() => props.onChange(o.value)}>
              <span dir="ltr">{o.label}</span>
              {o.hint && <small>{o.hint}</small>}
              {props.value === o.value && <Check size={16} />}
            </button>
          </li>
        ))}
        {shown.length === 0 && <li className="muted small">{t('c.noMatch')}</li>}
      </ul>
    </div>
  );
}
