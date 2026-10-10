import { useMemo, useState } from 'react';
import { CheckSquare, RotateCw, X, XCircle } from 'lucide-react';
import { useApp } from '../app/state.tsx';
import { useLoader } from '../app/useLoader.ts';
import { useAction } from '../app/useAction.ts';
import { useI18n } from '../i18n/index.tsx';
import {
  PATHS,
  activateSubscription,
  currentSubscription,
  groupByUser,
  idOf,
  isActiveSubscription,
  profilePrice,
  renewSubscription,
} from '../core/um.ts';
import type { RouterRecord } from '../core/routeros/client.ts';
import { can } from '../core/staff.ts';
import { formatMoney } from '../core/settings.ts';
import { daysLeft, formatDateTime } from '../core/time.ts';
import { Badge, Empty, ErrorBox, Fab, Loading, PageHeader, RefreshButton, SearchBar, Segmented, Sheet, confirm, matches } from '../ui/components.tsx';
import { PickList } from '../ui/PickList.tsx';

export function SubscriptionBadge({ sub }: { sub: RouterRecord | undefined }) {
  const { t } = useI18n();
  if (!sub) return <Badge tone="muted">{t('act.noSub')}</Badge>;
  const state = (sub.state ?? '').toLowerCase();
  if (state === 'running-active' || state === 'running') return <Badge tone="ok">{t('act.state.running-active')}</Badge>;
  if (state === 'waiting') return <Badge tone="warn">{t('act.state.waiting')}</Badge>;
  if (state === 'used') return <Badge tone="danger">{t('act.state.used')}</Badge>;
  return <Badge tone="muted">{sub.state}</Badge>;
}

type Filter = 'all' | 'active' | 'expired' | 'none';

interface Row {
  user: string;
  sub: RouterRecord | undefined;
  all: RouterRecord[];
}

export function Activations() {
  const { t, locale } = useI18n();
  const { role, session, ledger, settings } = useApp();
  const writable = can(role, 'operate');
  const data = useLoader(async (c) => {
    const [users, profiles, ups] = await Promise.all([c.list(PATHS.users), c.list(PATHS.profiles), c.list(PATHS.userProfiles)]);
    return { users, profiles, byUser: groupByUser(ups) };
  });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sheet, setSheet] = useState<{ kind: 'new' } | { kind: 'renew'; row: Row } | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { busy, run } = useAction();

  const rows: Row[] = useMemo(() => {
    if (!data.data) return [];
    return data.data.users
      .map((u) => {
        const all = data.data!.byUser.get(u.name ?? '') ?? [];
        return { user: u.name ?? '', sub: currentSubscription(all), all };
      })
      .filter((r) => matches(q, r.user, r.sub?.profile))
      .filter((r) => {
        const active = !!r.sub && isActiveSubscription(r.sub);
        if (filter === 'active') return active;
        if (filter === 'expired') return !!r.sub && !active;
        if (filter === 'none') return !r.sub;
        return true;
      })
      .sort((a, b) => a.user.localeCompare(b.user));
  }, [data.data, q, filter]);

  const cancel = async (users: string[]) => {
    if (!session || !data.data) return;
    const ok = await confirm({
      title: t('act.cancel'),
      message: users.length === 1 ? t('act.cancelConfirm', { name: users[0] }) : t('act.cancelMany', { n: users.length }),
      danger: true,
      confirmText: t('act.cancel'),
    });
    if (!ok) return;
    const ids = users.flatMap((u) => (data.data!.byUser.get(u) ?? []).filter(isActiveSubscription).map(idOf));
    const done = await run(async () => {
      await session.client.remove(PATHS.userProfiles, ids);
      await data.reload(true);
    }, t('c.saved'));
    if (done) {
      setSelected(new Set());
      setSelecting(false);
    }
  };

  const toggle = (u: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(u)) n.delete(u);
      else n.add(u);
      return n;
    });

  const endText = (sub: RouterRecord) => {
    const end = sub['end-time'] ?? '';
    if (!end || end === 'unlimited') return t('c.unlimited');
    if (end === 'not-yet-running') return t('act.notStarted');
    const left = daysLeft(end);
    return `${formatDateTime(end, locale)}${left !== null && left >= 0 && isActiveSubscription(sub) ? ` · ${left}d` : ''}`;
  };

  return (
    <div className="page">
      <PageHeader
        title={t('nav.activations')}
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
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'all', label: t('act.filterAll') },
          { value: 'active', label: t('act.filterActive') },
          { value: 'expired', label: t('act.filterExpired') },
          { value: 'none', label: t('act.filterNone') },
        ]}
      />
      {data.error && <ErrorBox message={data.error} onRetry={() => void data.reload()} />}
      {data.loading && !data.data && <Loading />}
      {selecting && (
        <div className="selection-bar">
          <span>{t('c.selected', { n: selected.size })}</span>
          <button className="btn small danger" disabled={!selected.size || busy} onClick={() => void cancel([...selected])}>
            <XCircle size={14} /> {t('act.cancel')}
          </button>
        </div>
      )}
      <ul className="cards">
        {rows.map((r) => {
          const active = !!r.sub && isActiveSubscription(r.sub);
          const queued = r.all.filter((x) => (x.state ?? '') === 'waiting').length;
          return (
            <li key={r.user} className={`item ${selected.has(r.user) ? 'selected' : ''}`} onClick={() => selecting && active && toggle(r.user)}>
              {selecting && <input type="checkbox" checked={selected.has(r.user)} disabled={!active} readOnly aria-label={r.user} />}
              <div className="item-main">
                <div className="item-title">
                  <strong dir="ltr">{r.user}</strong>
                  <SubscriptionBadge sub={r.sub} />
                  {queued > 0 && r.sub?.state !== 'waiting' && <Badge tone="info">+{queued}</Badge>}
                </div>
                {r.sub && (
                  <div className="item-sub">
                    <span dir="ltr">{r.sub.profile}</span>
                    <span>
                      {t('act.ends')}: <b>{endText(r.sub)}</b>
                    </span>
                  </div>
                )}
              </div>
              {!selecting && writable && (
                <div className="item-actions">
                  {r.sub ? (
                    <button className="btn small" onClick={() => setSheet({ kind: 'renew', row: r })}>
                      <RotateCw size={14} /> {t('act.renew')}
                    </button>
                  ) : null}
                  {active && (
                    <button className="icon-btn danger" onClick={() => void cancel([r.user])} aria-label={t('act.cancel')} disabled={busy}>
                      <XCircle size={18} />
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {data.data && rows.length === 0 && <Empty text={q ? t('c.noMatch') : t('c.empty')} />}
      {writable && <Fab label={t('act.start')} onClick={() => setSheet({ kind: 'new' })} />}

      {sheet && data.data && session && (
        <SubscriptionSheet
          mode={sheet.kind}
          row={sheet.kind === 'renew' ? sheet.row : undefined}
          users={data.data.users.map((u) => {
            const sub = currentSubscription(data.data!.byUser.get(u.name ?? '') ?? []);
            return { name: u.name ?? '', active: !!sub && isActiveSubscription(sub) };
          })}
          profiles={data.data.profiles}
          currency={settings.currency}
          onClose={() => setSheet(null)}
          onSubmit={async (user, profile, mode) => {
            const price = profilePrice(data.data!.profiles, profile);
            const ok = await run(async () => {
              if (sheet.kind === 'new') await activateSubscription(session.client, user, profile);
              else await renewSubscription(session.client, user, profile, mode);
              await ledger.record({ user, profile, price, actor: session.identity.username, kind: sheet.kind === 'new' ? 'activation' : 'renewal' });
              await data.reload(true);
            }, t('act.done'));
            if (ok) setSheet(null);
          }}
          busy={busy}
        />
      )}
    </div>
  );
}

function SubscriptionSheet(props: {
  mode: 'new' | 'renew';
  row?: Row;
  users: Array<{ name: string; active: boolean }>;
  profiles: RouterRecord[];
  currency: Parameters<typeof formatMoney>[1];
  busy: boolean;
  onClose: () => void;
  onSubmit: (user: string, profile: string, mode: 'replace' | 'queue') => Promise<void>;
}) {
  const { t } = useI18n();
  const [user, setUser] = useState(props.row?.user ?? '');
  const [profile, setProfile] = useState(props.row?.sub?.profile ?? '');
  const [when, setWhen] = useState<'replace' | 'queue'>('replace');
  const price = profile ? profilePrice(props.profiles, profile) : 0;
  return (
    <Sheet
      open
      title={props.mode === 'new' ? t('act.start') : t('act.renewTitle')}
      onClose={props.onClose}
      busy={props.busy}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose} disabled={props.busy}>
            {t('c.cancel')}
          </button>
          <button className="btn primary" disabled={!user || !profile || props.busy} onClick={() => void props.onSubmit(user, profile, when)}>
            {props.busy ? t('c.saving') : t('c.confirm')}
          </button>
        </>
      }
    >
      {props.mode === 'new' ? (
        <PickList
          label={t('act.user')}
          value={user}
          onChange={setUser}
          options={props.users.map((u) => ({ value: u.name, label: u.name, hint: u.active ? t('act.state.running-active') : undefined }))}
        />
      ) : (
        <div className="field">
          <label>{t('act.user')}</label>
          <strong dir="ltr">{user}</strong>
        </div>
      )}
      <div className="field">
        <label>{t('act.profile')}</label>
        <div className="choice-grid">
          {props.profiles.map((p) => (
            <button key={p.name} type="button" className={`choice ${profile === p.name ? 'on' : ''}`} onClick={() => setProfile(p.name ?? '')}>
              <strong dir="ltr">{p.name}</strong>
              <small dir="ltr">
                {p.validity || '∞'} · {formatMoney(parseFloat(p.price ?? '') || 0, props.currency)}
              </small>
            </button>
          ))}
        </div>
      </div>
      {props.mode === 'renew' && (
        <div className="field">
          <label>{t('act.mode')}</label>
          <Segmented
            value={when}
            onChange={setWhen}
            options={[
              { value: 'replace', label: t('act.modeReplace') },
              { value: 'queue', label: t('act.modeQueue') },
            ]}
          />
        </div>
      )}
      {profile && (
        <p className="price-line">
          {t('act.price')}: <b>{formatMoney(price, props.currency)}</b>
        </p>
      )}
    </Sheet>
  );
}
