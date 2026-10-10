import { useMemo, useState } from 'react';
import { CheckSquare, Pencil, Trash2, X } from 'lucide-react';
import { useApp } from '../app/state.tsx';
import { useLoader } from '../app/useLoader.ts';
import { useAction } from '../app/useAction.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { PATHS, currentSubscription, groupByUser, idOf } from '../core/um.ts';
import { isTrue, type RouterRecord } from '../core/routeros/client.ts';
import { can } from '../core/staff.ts';
import {
  formatAttributes,
  mergeSpeed,
  parseAttributes,
  speedLabel,
  splitSpeed,
  vAttributes,
  vIntRange,
  vName,
  vRate,
  vSecret,
  type Attribute,
  type UserSpeed,
} from '../core/validate.ts';
import { secureRandomString } from '../core/vouchers.ts';
import { AttributesEditor } from '../ui/AttributesEditor.tsx';
import { SpeedFields } from '../ui/SpeedFields.tsx';
import { Badge, CopyButton, Empty, ErrorBox, Fab, Field, Loading, PageHeader, RefreshButton, SearchBar, Sheet, Toggle, confirm, matches } from '../ui/components.tsx';
import { SubscriptionBadge } from './Activations.tsx';

export function Users() {
  const { t } = useI18n();
  const { role, session } = useApp();
  const writable = can(role, 'operate');
  const data = useLoader(async (c) => {
    const [users, ups] = await Promise.all([c.list(PATHS.users), c.list(PATHS.userProfiles)]);
    return { users, byUser: groupByUser(ups) };
  });
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<RouterRecord | 'new' | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { busy, run } = useAction();

  const list = useMemo(
    () => (data.data?.users ?? []).filter((u) => matches(q, u.name, u['caller-id'])).sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [data.data, q],
  );

  const removeMany = async (ids: string[], label: string) => {
    const ok = await confirm({
      title: t('c.delete'),
      message:
        ids.length === 1
          ? t('c.deleteConfirm', { name: label || (data.data?.users.find((u) => idOf(u) === ids[0])?.name ?? '') })
          : t('c.deleteMany', { n: ids.length }),
      danger: true,
      confirmText: t('c.delete'),
    });
    if (!ok) return;
    const done = await run(async () => {
      await session!.client.remove(PATHS.users, ids);
      await data.reload(true);
    }, t('c.deleted'));
    if (done) {
      setSelected(new Set());
      setSelecting(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="page">
      <PageHeader
        title={t('nav.users')}
        subtitle={data.data ? t('users.count', { n: data.data.users.length }) : undefined}
        actions={
          <>
            {writable && (
              <button className={`icon-btn ${selecting ? 'on' : ''}`} onClick={() => (setSelecting((s) => !s), setSelected(new Set()))} aria-label={t('c.selectAll')}>
                {selecting ? <X size={20} /> : <CheckSquare size={20} />}
              </button>
            )}
            <RefreshButton onClick={() => void data.reload()} busy={data.loading} />
          </>
        }
      />
      <SearchBar value={q} onChange={setQ} />
      {data.error && <ErrorBox message={data.error} onRetry={() => void data.reload()} />}
      {data.loading && !data.data && <Loading />}
      {selecting && (
        <div className="selection-bar">
          <span>{t('c.selected', { n: selected.size })}</span>
          <button className="btn small ghost" onClick={() => setSelected(new Set(list.map(idOf)))}>
            {t('c.selectAll')}
          </button>
          <button className="btn small danger" disabled={!selected.size || busy} onClick={() => void removeMany([...selected], '')}>
            <Trash2 size={14} /> {t('c.delete')}
          </button>
        </div>
      )}

      <ul className="cards">
        {list.map((u) => {
          const id = idOf(u);
          const sub = currentSubscription(data.data?.byUser.get(u.name ?? '') ?? []);
          return (
            <li key={id} className={`item ${selected.has(id) ? 'selected' : ''}`} onClick={() => (selecting ? toggle(id) : writable && setEditing(u))}>
              {selecting && <input type="checkbox" checked={selected.has(id)} readOnly aria-label={u.name} />}
              <div className="item-main">
                <div className="item-title">
                  <strong dir="ltr">{u.name}</strong>
                  {isTrue(u.disabled) && <Badge tone="muted">{t('c.disabled')}</Badge>}
                </div>
                <div className="item-sub">
                  <SubscriptionBadge sub={sub} />
                  {sub?.profile && <span dir="ltr">{sub.profile}</span>}
                  {speedLabel(u.attributes) && <span dir="ltr">{speedLabel(u.attributes)}</span>}
                  <span>
                    {t('users.devices')}: <b dir="ltr">{!u['shared-users'] || u['shared-users'] === 'unlimited' ? '∞' : u['shared-users']}</b>
                  </span>
                </div>
              </div>
              {!selecting && writable && (
                <div className="item-actions" onClick={(e) => e.stopPropagation()}>
                  <button className="icon-btn" onClick={() => setEditing(u)} aria-label={t('c.edit')}>
                    <Pencil size={18} />
                  </button>
                  <button className="icon-btn danger" onClick={() => void removeMany([id], u.name ?? '')} aria-label={t('c.delete')} disabled={busy}>
                    <Trash2 size={18} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {data.data && list.length === 0 && <Empty text={q ? t('c.noMatch') : t('c.empty')} />}
      {!writable && <p className="muted small center">{t('c.readOnly')}</p>}
      {writable && <Fab label={t('users.add')} onClick={() => setEditing('new')} />}
      {editing && <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => void data.reload(true)} />}
    </div>
  );
}

function UserForm(props: { user: RouterRecord | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n();
  const { session } = useApp();
  const u = props.user;
  const [name, setName] = useState(u?.name ?? '');
  const [password, setPassword] = useState('');
  const [shared, setShared] = useState(!u?.['shared-users'] || u['shared-users'] === 'unlimited' ? '' : u['shared-users']);
  const initial = splitSpeed(parseAttributes(u?.attributes));
  const [speed, setSpeed] = useState<UserSpeed>(initial.speed);
  const [attrs, setAttrs] = useState<Attribute[]>(initial.rest);
  const [callerId, setCallerId] = useState(u?.['caller-id'] ?? '');
  const [disabled, setDisabled] = useState(isTrue(u?.disabled));
  const [touched, setTouched] = useState(false);
  const { busy, run } = useAction();

  const errors = {
    name: vName(name) as MessageKey | null,
    password: (u && !password ? null : vSecret(password, 4)) as MessageKey | null,
    shared: vIntRange(shared, 1, 1000, false) as MessageKey | null,
    attrs: vAttributes(attrs) as MessageKey | null,
    callerId: vName(callerId, false) as MessageKey | null,
    download: vRate(speed.download) as MessageKey | null,
    upload: vRate(speed.upload) as MessageKey | null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const save = async () => {
    setTouched(true);
    if (invalid || !session) return;
    const data: Record<string, string> = {
      name: name.trim(),
      'shared-users': shared.trim() || 'unlimited',
      attributes: formatAttributes(mergeSpeed(attrs, speed)),
      disabled: disabled ? 'yes' : 'no',
    };
    // Only send caller-id when there is one to set or clear.
    if (callerId.trim() || u?.['caller-id']) data['caller-id'] = callerId.trim();
    if (password) data.password = password;
    const ok = await run(
      () => (u ? session.client.set(PATHS.users, idOf(u), data) : session.client.add(PATHS.users, data)),
      t('c.saved'),
    );
    if (ok) {
      props.onSaved();
      props.onClose();
    }
  };

  const show = (k: keyof typeof errors) => (touched ? errors[k] : null);
  return (
    <Sheet
      open
      title={u ? t('users.edit') : t('users.add')}
      onClose={props.onClose}
      busy={busy}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose} disabled={busy}>
            {t('c.cancel')}
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={busy}>
            {busy ? t('c.saving') : t('c.save')}
          </button>
        </>
      }
    >
      <Field label={t('c.username')} value={name} onChange={setName} ltr error={show('name')} autoFocus={!u} />
      {u?.password !== undefined && (
        <div className="field">
          <label>{t('c.password')}</label>
          <div className="secret-row" dir="ltr">
            <code>{u.password || '—'}</code>
            {u.password && <CopyButton text={u.password} />}
          </div>
        </div>
      )}
      <Field
        label={u ? `${t('c.password')} (${t('c.optional')})` : t('c.password')}
        value={password}
        onChange={setPassword}
        type="password"
        ltr
        error={show('password')}
        hint={u ? t('users.passwordKeep') : undefined}
        suffix={
          <button type="button" className="btn small ghost" onClick={() => setPassword(secureRandomString(8))}>
            {t('c.generate')}
          </button>
        }
      />
      <Field label={t('users.sharedUsers')} value={shared} onChange={setShared} ltr inputMode="numeric" hint={t('users.sharedHint')} error={show('shared')} />
      <Field label={`${t('users.callerId')} (${t('c.optional')})`} value={callerId} onChange={setCallerId} ltr error={show('callerId')} />
      <SpeedFields value={speed} onChange={setSpeed} errors={{ download: show('download'), upload: show('upload') }} />
      <AttributesEditor value={attrs} onChange={setAttrs} error={show('attrs') ? t(errors.attrs!) : null} />
      <Toggle label={t('users.disable')} checked={disabled} onChange={setDisabled} />
    </Sheet>
  );
}
