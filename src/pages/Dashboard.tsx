import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Clock, Cpu, MemoryStick, Ticket, Users, Wallet } from 'lucide-react';
import { useApp } from '../app/state.tsx';
import { useLoader } from '../app/useLoader.ts';
import { useI18n } from '../i18n/index.tsx';
import { PATHS, fetchResource, listActiveSessions, listInterfaces, monitorTraffic, planDistribution } from '../core/um.ts';
import { lastSevenDays, localDay, totalForDay } from '../core/ledger.ts';
import { formatBits, formatMoney } from '../core/settings.ts';
import { can } from '../core/staff.ts';
import { BarChart, Donut, TrafficChart } from '../ui/charts.tsx';
import { ErrorBox, Notice, PageHeader, RefreshButton } from '../ui/components.tsx';

export function Dashboard() {
  const { t, locale } = useI18n();
  const { session, settings, ledger, vouchers, role } = useApp();
  const finance = can(role, 'finance');

  const health = useLoader((c) => fetchResource(c), [], 5000);
  const stats = useLoader(
    async (c) => {
      const [sessions, ups] = await Promise.all([listActiveSessions(c), c.list(PATHS.userProfiles)]);
      return { active: sessions.length, plans: planDistribution(ups) };
    },
    [],
    60_000,
  );
  const [local, setLocal] = useState({ today: 0, stock: 0, week: [] as Array<{ label: string; value: number }> });
  useEffect(() => {
    void (async () => {
      const sales = await ledger.all();
      const stock = (await vouchers.all()).filter((v) => v.status === 'stock').length;
      const fmt = new Intl.DateTimeFormat(locale, { weekday: 'short' });
      setLocal({
        today: totalForDay(sales, localDay(new Date())),
        stock,
        week: lastSevenDays(sales).map((d) => ({ label: fmt.format(d.date), value: d.total })),
      });
    })();
  }, [ledger, vouchers, locale, stats.data]);

  // Traffic monitor: pick WAN/ether1 by default, poll every 3 s while visible.
  const ifaces = useLoader((c) => listInterfaces(c), []);
  const [iface, setIface] = useState('');
  const [points, setPoints] = useState<Array<{ rx: number; tx: number }>>([]);
  const pointsRef = useRef(points);
  pointsRef.current = points;
  useEffect(() => {
    if (iface || !ifaces.data?.length) return;
    const list = ifaces.data;
    const pick = list.find((i) => /wan/i.test(i.name ?? '')) ?? list.find((i) => i.name === 'ether1') ?? list[0];
    setIface(pick.name ?? '');
  }, [ifaces.data, iface]);
  useEffect(() => {
    if (!iface || !session) return;
    setPoints([]);
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const s = await monitorTraffic(session.client, iface);
        if (!stop) setPoints([...pointsRef.current, s].slice(-30));
      } catch {
        /* the header status dot already shows connectivity problems */
      }
    };
    void tick();
    const timer = setInterval(tick, 3000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [iface, session]);

  const r = health.data;
  const cpu = Number(r?.['cpu-load'] ?? 0);
  const total = Number(r?.['total-memory'] ?? 0);
  const free = Number(r?.['free-memory'] ?? 0);
  const mem = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
  const last = points[points.length - 1];

  return (
    <div className="page">
      <PageHeader
        title={t('dash.title')}
        subtitle={session ? `${session.identity.username} · ${t(`role.${role}`)}` : undefined}
        actions={<RefreshButton onClick={() => void stats.reload()} busy={stats.loading} />}
      />
      {session?.identity.username === 'admin' && <Notice kind="warn">{t('login.defaultAdminWarn')}</Notice>}
      {health.error && <ErrorBox message={health.error} onRetry={() => void health.reload()} />}

      <section className="stat-grid">
        <div className="stat">
          <Users size={18} />
          <span>{t('dash.active')}</span>
          <b>{stats.data?.active ?? '—'}</b>
        </div>
        <div className="stat">
          <Ticket size={18} />
          <span>{t('dash.stock')}</span>
          <b>{local.stock}</b>
        </div>
        {finance && (
          <div className="stat wide accent">
            <Wallet size={18} />
            <span>{t('dash.today')}</span>
            <b>{formatMoney(local.today, settings.currency)}</b>
            <small>{t('dash.todayHint')}</small>
          </div>
        )}
      </section>

      <section className="card">
        <div className="meters">
          <Meter icon={<Cpu size={16} />} label={t('dash.cpu')} value={cpu} />
          <Meter icon={<MemoryStick size={16} />} label={t('dash.memory')} value={mem} />
        </div>
        <dl className="kv">
          <dt>
            <Clock size={14} /> {t('dash.uptime')}
          </dt>
          <dd dir="ltr">{r?.uptime ?? '—'}</dd>
          <dt>{t('dash.version')}</dt>
          <dd dir="ltr">{r ? `${r.version ?? ''} · ${r['board-name'] ?? ''}` : '—'}</dd>
        </dl>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>{t('dash.traffic')}</h3>
          <select className="input compact" value={iface} onChange={(e) => setIface(e.target.value)} aria-label={t('dash.interface')} dir="ltr">
            {(ifaces.data ?? []).map((i) => (
              <option key={i['.id']} value={i.name}>
                {i.name}
              </option>
            ))}
          </select>
        </div>
        <TrafficChart points={points} />
        <div className="legend-row">
          {/* Interface counters: rx = received by the router (download on a WAN port). */}
          <span className="rx">
            ↓ {t('dash.download')} <b dir="ltr">{formatBits(last?.rx ?? 0)}</b>
          </span>
          <span className="tx">
            ↑ {t('dash.upload')} <b dir="ltr">{formatBits(last?.tx ?? 0)}</b>
          </span>
        </div>
      </section>

      {finance && (
        <section className="card">
          <h3>{t('dash.week')}</h3>
          <BarChart data={local.week} format={(v) => formatMoney(v, settings.currency).replace(/ IQD$/, '')} />
        </section>
      )}

      <section className="card">
        <h3>{t('dash.plans')}</h3>
        {stats.data && stats.data.plans.length > 0 ? <Donut data={stats.data.plans} /> : <p className="muted">{t('dash.noPlans')}</p>}
      </section>
    </div>
  );
}

function Meter(props: { icon: ReactNode; label: string; value: number }) {
  const v = Math.max(0, Math.min(100, props.value));
  const tone = v > 85 ? 'danger' : v > 65 ? 'warn' : 'ok';
  return (
    <div className="meter">
      <div className="meter-top">
        <span>
          {props.icon} {props.label}
        </span>
        <b dir="ltr">{v}%</b>
      </div>
      <div className="meter-bar">
        <span className={tone} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}
