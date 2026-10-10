import { useI18n, type MessageKey } from '../i18n/index.tsx';
import type { UserSpeed } from '../core/validate.ts';
import { Field } from './components.tsx';

/** Download/upload speed for one subscriber, saved as the Mikrotik-Rate-Limit attribute. */
export function SpeedFields(props: {
  value: UserSpeed;
  onChange: (v: UserSpeed) => void;
  errors: { download: MessageKey | null; upload: MessageKey | null };
}) {
  const { t } = useI18n();
  return (
    <div className="field">
      <label>{t('users.speed')}</label>
      <div className="row2">
        <Field
          label={`↓ ${t('lim.download')}`}
          value={props.value.download}
          onChange={(download) => props.onChange({ ...props.value, download })}
          ltr
          placeholder="400M"
          error={props.errors.download}
        />
        <Field
          label={`↑ ${t('lim.upload')}`}
          value={props.value.upload}
          onChange={(upload) => props.onChange({ ...props.value, upload })}
          ltr
          placeholder="400M"
          error={props.errors.upload}
        />
      </div>
      <small className="hint">{t('users.speedHint')}</small>
    </div>
  );
}
