import { useState } from 'react';
import { KeyRound, Power, Trash2 } from 'lucide-react';
import { useApp } from '../app/state.tsx';
import { useLoader } from '../app/useLoader.ts';
import { useAction } from '../app/useAction.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { addStaff, listStaff, removeStaff, setStaffDisabled, setStaffPassword, type Role, type StaffMember } from '../core/staff.ts';
import { vAddressList, vName, vSecret } from '../core/validate.ts';
import { secureRandomString } from '../core/vouchers.ts';
import { formatDateTime } from '../core/time.ts';
import { Badge, CopyButton, Empty, ErrorBox, Fab, Field, Loading, Notice, PageHeader, RefreshButton, Sheet, confirm } from '../ui/components.tsx';

const STRONG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_.';
const MIN_STAFF_PASSWORD = 10;

export function Staff() {
  const { t, locale } = useI18n();
  const { session } = useApp();
  const me = session?.identity.username ?? '';
  const data = useLoader((c) => listStaff(c));
  const [adding, setAdding] = useState(false);
  const [pwFor, setPwFor] = useState<StaffMember | null>(null);
  const { busy, run } = useAction();

  const remove = async (m: StaffMember) => {
    if (!session) return;
    if (!(await confirm({ title: t('c.delete'), message: t('c.deleteConfirm', { name: m.name }), danger: true, confirmText: t('c.delete') }))) return;
    await run(async () => {
      await removeStaff(session.client, me, m);
      await data.reload(true);
    }, t('c.deleted'));
  };

  const toggleDisabled = async (m: StaffMember) => {
    if (!session) return;
    await run(async () => {
      await setStaffDisabled(session.client, me, m, !m.disabled);
      await data.reload(true);
    }, t('c.saved'));
  };

  const roleTone = (r: Role) => (r === 'admin' ? 'danger' : r === 'support' ? 'info' : 'muted');
  return (
    <div className="page">
      <PageHeader title={t('nav.staff')} actions={<RefreshButton onClick={() => void data.reload()} busy={data.loading} />} />
      <Notice>{t('staff.routerNote')}</Notice>
      {data.error && <ErrorBox message={data.error} onRetry={() => void data.reload()} />}
      {data.loading && !data.data && <Loading />}
      <ul className="cards">
        {(data.data ?? []).map((m) => (
          <li key={m.id} className="item">
            <div className="item-main">
              <div className="item-title">
                <strong dir="ltr">{m.name}</strong>
                <Badge tone={roleTone(m.role)}>{t(`role.${m.role}`)}</Badge>
                {m.disabled && <Badge tone="muted">{t('c.disabled')}</Badge>}
                {m.name === me && <Badge tone="ok">{t('staff.you')}</Badge>}
              </div>
              <div className="item-sub">
                <span dir="ltr">{m.group}</span>
                {m.allowedAddress && <span dir="ltr">{m.allowedAddress}</span>}
                <span>
                  {t('staff.lastLogin')}: {m.lastLoggedIn ? formatDateTime(m.lastLoggedIn, locale) : t('staff.never')}
                </span>
                {m.comment && <span>{m.comment}</span>}
              </div>
            </div>
            {m.name !== me && (
              <div className="item-actions">
                <button className="icon-btn" onClick={() => setPwFor(m)} aria-label={t('staff.setPassword')}>
                  <KeyRound size={18} />
                </button>
                <button className="icon-btn" onClick={() => void toggleDisabled(m)} aria-label={m.disabled ? t('staff.enable') : t('staff.disable')} disabled={busy}>
                  <Power size={18} />
                </button>
                <button className="icon-btn danger" onClick={() => void remove(m)} aria-label={t('c.delete')} disabled={busy}>
                  <Trash2 size={18} />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {data.data && data.data.length === 0 && <Empty text={t('c.empty')} />}
      <Fab label={t('staff.add')} onClick={() => setAdding(true)} />
      {adding && <AddStaffSheet onClose={() => setAdding(false)} onDone={() => void data.reload(true)} />}
      {pwFor && <PasswordSheet member={pwFor} onClose={() => setPwFor(null)} />}
    </div>
  );
}

function AddStaffSheet(props: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { session } = useApp();
  const [name, setName] = useState('');
  const [password, setPassword] = useState(() => secureRandomString(14, STRONG_ALPHABET));
  const [role, setRole] = useState<Role>('support');
  const [allowed, setAllowed] = useState('');
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const [created, setCreated] = useState(false);
  const { busy, run } = useAction();
  const e = {
    name: vName(name) as MessageKey | null,
    password: (vSecret(password, MIN_STAFF_PASSWORD) ?? (password === name ? 'v.passwordSameAsUser' : null)) as MessageKey | null,
    allowed: vAddressList(allowed) as MessageKey | null,
  };
  const show = (k: keyof typeof e) => (touched ? e[k] : null);

  const save = async () => {
    setTouched(true);
    if (Object.values(e).some(Boolean) || !session) return;
    const ok = await run(() => addStaff(session.client, { name: name.trim(), password, role, allowedAddress: allowed, comment }), t('c.saved'));
    if (ok) {
      setCreated(true);
      props.onDone();
    }
  };

  const roles: Array<{ value: Role; hint: MessageKey }> = [
    { value: 'support', hint: 'staff.roleSupportHint' },
    { value: 'viewer', hint: 'staff.roleViewerHint' },
    { value: 'admin', hint: 'staff.roleAdminHint' },
  ];
  return (
    <Sheet
      open
      title={t('staff.add')}
      onClose={props.onClose}
      busy={busy}
      footer={
        created ? (
          <button className="btn primary" onClick={props.onClose}>
            {t('c.done')}
          </button>
        ) : (
          <>
            <button className="btn ghost" onClick={props.onClose} disabled={busy}>
              {t('c.cancel')}
            </button>
            <button className="btn primary" onClick={() => void save()} disabled={busy}>
              {busy ? t('c.saving') : t('c.save')}
            </button>
          </>
        )
      }
    >
      {created ? (
        <div className="created">
          <p>{t('staff.passwordNote')}</p>
          <div className="secret-row" dir="ltr">
            <code>{name}</code>
          </div>
          <div className="secret-row" dir="ltr">
            <code>{password}</code>
            <CopyButton text={password} />
          </div>
        </div>
      ) : (
        <>
          <Field label={t('c.username')} value={name} onChange={setName} ltr error={show('name')} autoFocus />
          <Field
            label={t('c.password')}
            value={password}
            onChange={setPassword}
            type="password"
            ltr
            error={show('password')}
            suffix={
              <button type="button" className="btn small ghost" onClick={() => setPassword(secureRandomString(14, STRONG_ALPHABET))}>
                {t('c.generate')}
              </button>
            }
          />
          <div className="field">
            <label>{t('staff.role')}</label>
            <div className="choice-grid one">
              {roles.map((r) => (
                <button key={r.value} type="button" className={`choice ${role === r.value ? 'on' : ''}`} onClick={() => setRole(r.value)}>
                  <strong>{t(`role.${r.value}`)}</strong>
                  <small>{t(r.hint)}</small>
                </button>
              ))}
            </div>
          </div>
          <Field label={`${t('staff.allowed')} (${t('c.optional')})`} value={allowed} onChange={setAllowed} ltr error={show('allowed')} hint={t('staff.allowedHint')} />
          <Field label={`${t('staff.comment')} (${t('c.optional')})`} value={comment} onChange={setComment} />
        </>
      )}
    </Sheet>
  );
}

function PasswordSheet(props: { member: StaffMember; onClose: () => void }) {
  const { t } = useI18n();
  const { session } = useApp();
  const [password, setPassword] = useState(() => secureRandomString(14, STRONG_ALPHABET));
  const [done, setDone] = useState(false);
  const { busy, run } = useAction();
  const error = (vSecret(password, MIN_STAFF_PASSWORD) ?? (password === props.member.name ? 'v.passwordSameAsUser' : null)) as MessageKey | null;
  return (
    <Sheet
      open
      title={`${t('staff.setPassword')} — ${props.member.name}`}
      onClose={props.onClose}
      busy={busy}
      footer={
        done ? (
          <button className="btn primary" onClick={props.onClose}>
            {t('c.done')}
          </button>
        ) : (
          <>
            <button className="btn ghost" onClick={props.onClose} disabled={busy}>
              {t('c.cancel')}
            </button>
            <button
              className="btn primary"
              disabled={busy || !!error}
              onClick={async () => {
                if (!session) return;
                if (await run(() => setStaffPassword(session.client, props.member, password), t('c.saved'))) setDone(true);
              }}
            >
              {t('c.save')}
            </button>
          </>
        )
      }
    >
      {done ? (
        <div className="created">
          <p>{t('staff.passwordNote')}</p>
          <div className="secret-row" dir="ltr">
            <code>{password}</code>
            <CopyButton text={password} />
          </div>
        </div>
      ) : (
        <Field label={t('set.newPassword')} value={password} onChange={setPassword} type="password" ltr error={error} />
      )}
    </Sheet>
  );
}
