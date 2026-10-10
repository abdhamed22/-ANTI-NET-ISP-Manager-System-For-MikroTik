import { useMemo, useState } from 'react';
import { Unplug } from 'lucide-react';
import { useApp } from '../app/state.tsx';
import { useLoader } from '../app/useLoader.ts';
import { useAction } from '../app/useAction.ts';
import { useI18n } from '../i18n/index.tsx';
import {
  PATHS,
  disconnectUser,
  idOf,
  listActiveSessions,
  isSessionActive,
  sessionAddress,
  sessionDownload,
  sessionEnded,
  sessionStarted,
  sessionUpload,
  sessionUser,
} from '../core/um.ts';
import { can } from '../core/staff.ts';
import { formatBytes } from '../core/settings.ts';
import { formatDateTime, parseRouterDate } from '../core/time.ts';
import type { RouterRecord } from '../core/routeros/client.ts';
import { Empty, ErrorBox, Loading, PageHeader, RefreshButton, SearchBar, confirm, matches } from '../ui/components.tsx';

const HISTORY_LIMIT = 300;

function startedTime(s: RouterRecord): number {
  return parseRouterDate(sessionStarted(s))?.getTime() ?? 0;
}

export function Sessions() {
  const { t } = useI18n();
  const { role, session, toast } = useApp();
  const writable = can(role, 'operate');
  const data = useLoader((c) => listActiveSessions(c), [], 10_000);
  const [q, setQ] = useState('');
  const { busy, run } = useAction();

  const list = useMemo(
    () =>
      (data.data ?? [])
        .filter(isSessionActive)
        .filter((s) => matches(q, sessionUser(s), sessionAddress(s)))
        .sort((a, b) => startedTime(b) - startedTime(a)),
    [data.data, q],
  );

  const disconnect = async (user: string) => {
    if (!session) return;
    if (!(await confirm({ title: t('ses.disconnect'), message: t('ses.disconnectConfirm', { name: user }), danger: true, confirmText: t('ses.disconnect') }))) return;
    await run(async () => {
      const n = await disconnectUser(session.client, user);
      if (n > 0) toast(t('ses.disconnected', { n }), 'ok');
      else toast(t('ses.notFound'), 'info');
      await data.reload(true);
    });
  };

  return (
    <div className="page">
      <PageHeader title={t('nav.sessions')} subtitle={t('ses.autoRefresh')} actions={<RefreshButton onClick={() => void data.reload()} busy={data.loading} />} />
      <SearchBar value={q} onChange={setQ} />
      {data.error && <ErrorBox message={data.error} onRetry={() => void data.reload()} />}
      {data.loading && !data.data && <Loading />}
      <ul className="cards">
        {list.map((s) => (
          <li key={idOf(s)} className="item">
            <div className="item-main">
              <div className="item-title">
                <span className="live-dot" />
                <strong dir="ltr">{sessionUser(s)}</strong>
              </div>
              <div className="item-sub">
                <span dir="ltr">{sessionAddress(s) || '—'}</span>
                <span>
                  {t('ses.uptime')}: <b dir="ltr">{s.uptime ?? '—'}</b>
                </span>
                <span dir="ltr">
                  ↓ {formatBytes(sessionDownload(s))} · ↑ {formatBytes(sessionUpload(s))}
                </span>
              </div>
            </div>
            {writable && (
              <div className="item-actions">
                <button className="btn small danger" onClick={() => void disconnect(sessionUser(s))} disabled={busy}>
                  <Unplug size={14} /> {t('ses.disconnect')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {data.data && list.length === 0 && <Empty text={q ? t('c.noMatch') : t('c.empty')} />}
    </div>
  );
}

export function SessionHistory() {
  const { t, locale } = useI18n();
  const data = useLoader((c) => c.list(PATHS.sessions));
  const [q, setQ] = useState('');
  const list = useMemo(
    () =>
      (data.data ?? [])
        .filter((s) => !isSessionActive(s))
        .filter((s) => matches(q, sessionUser(s), sessionAddress(s), s['terminate-cause']))
        .sort((a, b) => startedTime(b) - startedTime(a))
        .slice(0, HISTORY_LIMIT),
    [data.data, q],
  );
  return (
    <div className="page">
      <PageHeader title={t('nav.history')} subtitle={t('ses.historyLimit', { n: HISTORY_LIMIT })} actions={<RefreshButton onClick={() => void data.reload()} busy={data.loading} />} />
      <SearchBar value={q} onChange={setQ} />
      {data.error && <ErrorBox message={data.error} onRetry={() => void data.reload()} />}
      {data.loading && !data.data && <Loading />}
      <ul className="cards">
        {list.map((s) => (
          <li key={idOf(s)} className="item">
            <div className="item-main">
              <div className="item-title">
                <strong dir="ltr">{sessionUser(s)}</strong>
                {s['terminate-cause'] && <small className="muted" dir="ltr">{s['terminate-cause']}</small>}
              </div>
              <div className="item-sub">
                <span>
                  {t('ses.started')}: {formatDateTime(sessionStarted(s), locale)}
                </span>
                <span>
                  {t('ses.ended')}: {formatDateTime(sessionEnded(s), locale)}
                </span>
                <span dir="ltr">{sessionAddress(s) || '—'}</span>
                <span dir="ltr">
                  {s.uptime ?? ''} · ↓ {formatBytes(sessionDownload(s))} · ↑ {formatBytes(sessionUpload(s))}
                </span>
              </div>
            </div>
          </li>
        ))}
      </ul>
      {data.data && list.length === 0 && <Empty text={q ? t('c.noMatch') : t('c.empty')} />}
    </div>
  );
}
