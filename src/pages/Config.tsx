import { useMemo, useState, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useApp } from '../app/state.tsx';
import { useLoader } from '../app/useLoader.ts';
import { useAction } from '../app/useAction.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { PATHS, idOf } from '../core/um.ts';
import { isTrue, type RouterClient, type RouterRecord } from '../core/routeros/client.ts';
import { formatMoney } from '../core/settings.ts';
import { WEEKDAYS, vBytes, vDuration, vIPv4, vName, vPort, vPrice, vRate, vSecret, vTime } from '../core/validate.ts';
import { secureRandomString } from '../core/vouchers.ts';
import { Badge, Empty, ErrorBox, Fab, Field, Loading, PageHeader, RefreshButton, SearchBar, Segmented, SelectField, Sheet, Toggle, confirm, matches } from '../ui/components.tsx';

// Shared list + sheet scaffolding for the admin configuration menus.

type Path = (typeof PATHS)[keyof typeof PATHS];

function ConfigList<Extra>(props: {
  title: string;
  addLabel: string;
  path: Path;
  extra?: (c: RouterClient) => Promise<Extra>;
  searchKeys: (r: RouterRecord) => Array<string | undefined>;
  render: (r: RouterRecord) => { title: ReactNode; sub?: ReactNode };
  label: (r: RouterRecord) => string;
  form: (p: { item: RouterRecord | null; extra: Extra | undefined; onDone: () => void; onClose: () => void }) => ReactNode;
  canEdit?: boolean;
}) {
  const { t } = useI18n();
  const { session } = useApp();
  const data = useLoader(async (c) => ({ rows: await c.list(props.path), extra: props.extra ? await props.extra(c) : undefined }), [props.path]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<RouterRecord | 'new' | null>(null);
  const { busy, run } = useAction();
  const rows = useMemo(() => (data.data?.rows ?? []).filter((r) => matches(q, ...props.searchKeys(r))), [data.data, q, props]);

  const remove = async (r: RouterRecord) => {
    if (!session) return;
    if (!(await confirm({ title: t('c.delete'), message: t('c.deleteConfirm', { name: props.label(r) }), danger: true, confirmText: t('c.delete') }))) return;
    await run(async () => {
      await session.client.remove(props.path, idOf(r));
      await data.reload(true);
    }, t('c.deleted'));
  };

  return (
    <div className="page">
      <PageHeader title={props.title} actions={<RefreshButton onClick={() => void data.reload()} busy={data.loading} />} />
      <SearchBar value={q} onChange={setQ} />
      {data.error && <ErrorBox message={data.error} onRetry={() => void data.reload()} />}
      {data.loading && !data.data && <Loading />}
      <ul className="cards">
        {rows.map((r) => {
          const v = props.render(r);
          return (
            <li key={idOf(r)} className="item" onClick={() => props.canEdit !== false && setEditing(r)}>
              <div className="item-main">
                <div className="item-title">{v.title}</div>
                {v.sub && <div className="item-sub">{v.sub}</div>}
              </div>
              <div className="item-actions" onClick={(e) => e.stopPropagation()}>
                {props.canEdit !== false && (
                  <button className="icon-btn" onClick={() => setEditing(r)} aria-label={t('c.edit')}>
                    <Pencil size={18} />
                  </button>
                )}
                <button className="icon-btn danger" onClick={() => void remove(r)} aria-label={t('c.delete')} disabled={busy}>
                  <Trash2 size={18} />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {data.data && rows.length === 0 && <Empty text={q ? t('c.noMatch') : t('c.empty')} />}
      <Fab label={props.addLabel} onClick={() => setEditing('new')} />
      {editing &&
        props.form({
          item: editing === 'new' ? null : editing,
          extra: data.data?.extra,
          onClose: () => setEditing(null),
          onDone: () => {
            setEditing(null);
            void data.reload(true);
          },
        })}
    </div>
  );
}

/** Sheet with save/cancel that validates before calling the router. */
function FormSheet(props: { title: string; invalid: boolean; onSave: () => Promise<void>; onClose: () => void; busy: boolean; children: ReactNode; setTouched: (v: boolean) => void }) {
  const { t } = useI18n();
  return (
    <Sheet
      open
      title={props.title}
      onClose={props.onClose}
      busy={props.busy}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose} disabled={props.busy}>
            {t('c.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={props.busy}
            onClick={() => {
              props.setTouched(true);
              if (!props.invalid) void props.onSave();
            }}
          >
            {props.busy ? t('c.saving') : t('c.save')}
          </button>
        </>
      }
    >
      {props.children}
    </Sheet>
  );
}

function useSave(path: Path, item: RouterRecord | null, onDone: () => void) {
  const { session } = useApp();
  const { t } = useI18n();
  const { busy, run } = useAction();
  const save = async (data: Record<string, string>) => {
    if (!session) return;
    const ok = await run(() => (item ? session.client.set(path, idOf(item), data) : session.client.add(path, data)), t('c.saved'));
    if (ok) onDone();
  };
  return { busy, save };
}

type Errs<K extends string> = Record<K, MessageKey | null>;
const err = (v: string | null) => v as MessageKey | null;

// ------------------------------------------------------------------ Routers (NAS)

export function Routers() {
  const { t } = useI18n();
  return (
    <ConfigList
      title={t('nav.routers')}
      addLabel={t('rt.add')}
      path={PATHS.routers}
      searchKeys={(r) => [r.name, r.address]}
      label={(r) => r.name ?? ''}
      render={(r) => ({
        title: (
          <>
            <strong dir="ltr">{r.name}</strong>
            {isTrue(r.disabled) && <Badge tone="muted">{t('c.disabled')}</Badge>}
          </>
        ),
        sub: (
          <>
            <span dir="ltr">{r.address}</span>
            <span dir="ltr">CoA {r['coa-port'] ?? '3799'}</span>
          </>
        ),
      })}
      form={(p) => <RouterForm {...p} />}
    />
  );
}

function RouterForm(p: { item: RouterRecord | null; onDone: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(p.item?.name ?? '');
  const [address, setAddress] = useState(p.item?.address ?? '');
  const [secret, setSecret] = useState(p.item?.['shared-secret'] ?? '');
  const [coa, setCoa] = useState(p.item?.['coa-port'] ?? '3799');
  const [disabled, setDisabled] = useState(isTrue(p.item?.disabled));
  const [touched, setTouched] = useState(false);
  const { busy, save } = useSave(PATHS.routers, p.item, p.onDone);
  const e: Errs<'name' | 'address' | 'secret' | 'coa'> = {
    name: err(vName(name)),
    address: err(vIPv4(address)),
    secret: err(vSecret(secret, 8)),
    coa: err(vPort(coa)),
  };
  const show = (k: keyof typeof e) => (touched ? e[k] : null);
  return (
    <FormSheet
      title={p.item ? t('rt.edit') : t('rt.add')}
      invalid={Object.values(e).some(Boolean)}
      busy={busy}
      setTouched={setTouched}
      onClose={p.onClose}
      onSave={() => save({ name: name.trim(), address: address.trim(), 'shared-secret': secret, 'coa-port': coa.trim(), disabled: disabled ? 'yes' : 'no' })}
    >
      <Field label={t('c.name')} value={name} onChange={setName} ltr error={show('name')} placeholder="Main-Tower" />
      <Field label={t('rt.address')} value={address} onChange={setAddress} ltr inputMode="decimal" error={show('address')} placeholder="192.168.88.1" />
      <Field
        label={t('rt.secret')}
        value={secret}
        onChange={setSecret}
        type="password"
        ltr
        error={show('secret')}
        hint={t('rt.secretHint')}
        suffix={
          <button type="button" className="btn small ghost" onClick={() => setSecret(secureRandomString(20))}>
            {t('c.generate')}
          </button>
        }
      />
      <Field label={t('rt.coa')} value={coa} onChange={setCoa} ltr inputMode="numeric" error={show('coa')} />
      <Toggle label={t('c.disabled')} checked={disabled} onChange={setDisabled} />
    </FormSheet>
  );
}

// ------------------------------------------------------------------ Profiles

export function Profiles() {
  const { t } = useI18n();
  const { settings } = useApp();
  return (
    <ConfigList
      title={t('nav.profiles')}
      addLabel={t('pf.add')}
      path={PATHS.profiles}
      searchKeys={(r) => [r.name, r['name-for-users']]}
      label={(r) => r.name ?? ''}
      render={(r) => ({
        title: <strong dir="ltr">{r.name}</strong>,
        sub: (
          <>
            <span dir="ltr">{r.validity || '∞'}</span>
            <b>{formatMoney(parseFloat(r.price ?? '') || 0, settings.currency)}</b>
            {r['name-for-users'] && <span dir="ltr">{r['name-for-users']}</span>}
          </>
        ),
      })}
      form={(p) => <ProfileForm {...p} />}
    />
  );
}

function ProfileForm(p: { item: RouterRecord | null; onDone: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(p.item?.name ?? '');
  const [shown, setShown] = useState(p.item?.['name-for-users'] ?? '');
  const [validity, setValidity] = useState(p.item?.validity ?? '30d');
  const [price, setPrice] = useState(p.item?.price ?? '');
  const [starts, setStarts] = useState<'assigned' | 'first-auth'>(p.item?.['starts-when'] === 'first-auth' ? 'first-auth' : 'assigned');
  const [touched, setTouched] = useState(false);
  const { busy, save } = useSave(PATHS.profiles, p.item, p.onDone);
  const e: Errs<'name' | 'validity' | 'price' | 'shown'> = {
    name: err(vName(name)),
    validity: err(vDuration(validity, true)),
    price: err(vPrice(price)),
    shown: shown.length > 64 ? 'v.tooLong' : null,
  };
  const show = (k: keyof typeof e) => (touched ? e[k] : null);
  return (
    <FormSheet
      title={p.item ? t('pf.edit') : t('pf.add')}
      invalid={Object.values(e).some(Boolean)}
      busy={busy}
      setTouched={setTouched}
      onClose={p.onClose}
      onSave={() => {
        const data: Record<string, string> = { name: name.trim(), validity: validity.trim(), 'starts-when': starts, price: price.trim() || '0' };
        // Only send the display name when there is one to set or clear.
        if (shown.trim() || p.item?.['name-for-users']) data['name-for-users'] = shown.trim();
        return save(data);
      }}
    >
      <Field label={t('c.name')} value={name} onChange={setName} ltr error={show('name')} placeholder="10M-Month" />
      <Field label={`${t('pf.nameForUsers')} (${t('c.optional')})`} value={shown} onChange={setShown} error={show('shown')} />
      <Field label={t('pf.validity')} value={validity} onChange={setValidity} ltr error={show('validity')} hint={t('pf.validityHint')} />
      <Field label={t('pf.price')} value={price} onChange={setPrice} ltr inputMode="decimal" error={show('price')} />
      <div className="field">
        <label>{t('pf.startsWhen')}</label>
        <Segmented
          value={starts}
          onChange={setStarts}
          options={[
            { value: 'assigned', label: t('pf.startsAssigned') },
            { value: 'first-auth', label: t('pf.startsFirstAuth') },
          ]}
        />
      </div>
    </FormSheet>
  );
}

// ------------------------------------------------------------------ Limitations

/**
 * User Manager speeds are named from the router's side: rate-limit-rx is what
 * the router receives (subscriber UPLOAD) and rate-limit-tx is what it sends
 * (subscriber DOWNLOAD). download-limit/upload-limit are byte QUOTAS, not speeds.
 */
export function Limitations() {
  const { t } = useI18n();
  return (
    <ConfigList
      title={t('nav.limitations')}
      addLabel={t('lim.add')}
      path={PATHS.limitations}
      searchKeys={(r) => [r.name]}
      label={(r) => r.name ?? ''}
      render={(r) => ({
        title: <strong dir="ltr">{r.name}</strong>,
        sub: (
          <>
            <span>
              ↓ <b dir="ltr">{r['rate-limit-tx'] || '∞'}</b>
            </span>
            <span>
              ↑ <b dir="ltr">{r['rate-limit-rx'] || '∞'}</b>
            </span>
            {hasQuota(r['transfer-limit']) && <span dir="ltr">Σ {r['transfer-limit']}</span>}
          </>
        ),
      })}
      form={(p) => <LimitationForm {...p} />}
    />
  );
}

const hasQuota = (v: string | undefined) => !!v && v !== '0' && v !== '0B';
const quotaValue = (v: string | undefined) => (hasQuota(v) ? (v ?? '') : '');
const uptimeValue = (v: string | undefined) => (!v || v === '0s' || v === '00:00:00' ? '' : v);

function LimitationForm(p: { item: RouterRecord | null; onDone: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const it = p.item;
  const [name, setName] = useState(it?.name ?? '');
  const [down, setDown] = useState(it?.['rate-limit-tx'] ?? '');
  const [up, setUp] = useState(it?.['rate-limit-rx'] ?? '');
  const [qDown, setQDown] = useState(quotaValue(it?.['download-limit']));
  const [qUp, setQUp] = useState(quotaValue(it?.['upload-limit']));
  const [qTotal, setQTotal] = useState(quotaValue(it?.['transfer-limit']));
  const [uptime, setUptime] = useState(uptimeValue(it?.['uptime-limit']));
  const [touched, setTouched] = useState(false);
  const { busy, save } = useSave(PATHS.limitations, it, p.onDone);
  const e: Errs<'name' | 'down' | 'up' | 'qDown' | 'qUp' | 'qTotal' | 'uptime'> = {
    name: err(vName(name)),
    down: err(vRate(down)),
    up: err(vRate(up)),
    qDown: err(vBytes(qDown)),
    qUp: err(vBytes(qUp)),
    qTotal: err(vBytes(qTotal)),
    uptime: err(vDuration(uptime)),
  };
  const show = (k: keyof typeof e) => (touched ? e[k] : null);
  return (
    <FormSheet
      title={it ? t('lim.edit') : t('lim.add')}
      invalid={Object.values(e).some(Boolean)}
      busy={busy}
      setTouched={setTouched}
      onClose={p.onClose}
      onSave={() =>
        save({
          name: name.trim(),
          'rate-limit-tx': down.trim() || '0',
          'rate-limit-rx': up.trim() || '0',
          'download-limit': qDown.trim() || '0',
          'upload-limit': qUp.trim() || '0',
          'transfer-limit': qTotal.trim() || '0',
          'uptime-limit': uptime.trim() || '0s',
        })
      }
    >
      <Field label={t('c.name')} value={name} onChange={setName} ltr error={show('name')} placeholder="10M" />
      <Field label={`↓ ${t('lim.download')}`} value={down} onChange={setDown} ltr error={show('down')} hint={t('lim.speedHint')} placeholder="10M" />
      <Field label={`↑ ${t('lim.upload')}`} value={up} onChange={setUp} ltr error={show('up')} hint={t('lim.speedHint')} placeholder="2M" />
      <p className="section-label">{t('lim.quota')}</p>
      <Field label={t('lim.downloadQuota')} value={qDown} onChange={setQDown} ltr error={show('qDown')} hint={t('lim.quotaHint')} />
      <Field label={t('lim.uploadQuota')} value={qUp} onChange={setQUp} ltr error={show('qUp')} />
      <Field label={t('lim.transferQuota')} value={qTotal} onChange={setQTotal} ltr error={show('qTotal')} />
      <Field label={t('lim.uptime')} value={uptime} onChange={setUptime} ltr error={show('uptime')} placeholder="12h" />
    </FormSheet>
  );
}

// ------------------------------------------------------------------ Profile ↔ limitation links

export function ProfileLinks() {
  const { t } = useI18n();
  const dayLabel = (days: string | undefined) => {
    const list = (days ?? '').split(',').filter(Boolean);
    if (list.length === 0 || list.length === 7) return null;
    return list.map((d) => t(`day.${d}` as MessageKey)).join('، ');
  };
  return (
    <ConfigList
      title={t('nav.links')}
      addLabel={t('ln.add')}
      path={PATHS.profileLimitations}
      canEdit={false}
      extra={async (c) => ({ profiles: await c.list(PATHS.profiles), limitations: await c.list(PATHS.limitations) })}
      searchKeys={(r) => [r.profile, r.limitation]}
      label={(r) => `${r.profile} → ${r.limitation}`}
      render={(r) => ({
        title: (
          <strong dir="ltr">
            {r.profile} → {r.limitation}
          </strong>
        ),
        sub: (
          <>
            <span dir="ltr">
              {r['from-time'] ?? '0s'} – {r['till-time'] ?? '23:59:59'}
            </span>
            {dayLabel(r.weekdays) && <span>{dayLabel(r.weekdays)}</span>}
          </>
        ),
      })}
      form={(p) => <LinkForm {...p} />}
    />
  );
}

function LinkForm(p: { extra: { profiles: RouterRecord[]; limitations: RouterRecord[] } | undefined; onDone: () => void; onClose: () => void }) {
  const { t } = useI18n();
  const [profile, setProfile] = useState('');
  const [limitation, setLimitation] = useState('');
  const [from, setFrom] = useState('00:00:00');
  const [till, setTill] = useState('23:59:59');
  const [days, setDays] = useState<Set<string>>(new Set(WEEKDAYS));
  const [touched, setTouched] = useState(false);
  const { busy, save } = useSave(PATHS.profileLimitations, null, p.onDone);
  const e: Errs<'profile' | 'limitation' | 'from' | 'till' | 'days'> = {
    profile: profile ? null : 'v.required',
    limitation: limitation ? null : 'v.required',
    from: err(vTime(from)),
    till: err(vTime(till)),
    days: days.size ? null : 'v.required',
  };
  const show = (k: keyof typeof e) => (touched ? e[k] : null);
  return (
    <FormSheet
      title={t('ln.add')}
      invalid={Object.values(e).some(Boolean)}
      busy={busy}
      setTouched={setTouched}
      onClose={p.onClose}
      onSave={() => save({ profile, limitation, 'from-time': from, 'till-time': till, weekdays: WEEKDAYS.filter((d) => days.has(d)).join(',') })}
    >
      <SelectField
        label={t('act.profile')}
        value={profile}
        onChange={setProfile}
        placeholder={t('act.choose')}
        options={(p.extra?.profiles ?? []).map((x) => ({ value: x.name ?? '', label: x.name ?? '' }))}
        error={show('profile')}
      />
      <SelectField
        label={t('ln.limitation')}
        value={limitation}
        onChange={setLimitation}
        placeholder={t('act.choose')}
        options={(p.extra?.limitations ?? []).map((x) => ({ value: x.name ?? '', label: x.name ?? '' }))}
        error={show('limitation')}
      />
      <div className="row2">
        <Field label={t('ln.from')} value={from} onChange={setFrom} ltr error={show('from')} />
        <Field label={t('ln.till')} value={till} onChange={setTill} ltr error={show('till')} />
      </div>
      <div className={`field ${show('days') ? 'has-error' : ''}`}>
        <label>{t('ln.days')}</label>
        <div className="day-picker">
          {WEEKDAYS.map((d) => (
            <button
              type="button"
              key={d}
              className={days.has(d) ? 'on' : ''}
              onClick={() =>
                setDays((s) => {
                  const n = new Set(s);
                  if (n.has(d)) n.delete(d);
                  else n.add(d);
                  return n;
                })
              }
            >
              {t(`day.${d}` as MessageKey)}
            </button>
          ))}
        </div>
      </div>
    </FormSheet>
  );
}

