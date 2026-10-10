import { useState, type ReactNode } from 'react';
import {
  Activity,
  Gauge,
  History,
  LayoutDashboard,
  Layers,
  Link2,
  LogOut,
  Menu,
  MoreHorizontal,
  Server,
  Settings,
  ShieldAlert,
  Ticket,
  UserCog,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react';
import { useApp, type PageId } from '../app/state.tsx';
import { useBackHandler } from '../app/back.ts';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { can } from '../core/staff.ts';

type Need = 'any' | 'operate' | 'configure' | 'finance' | 'staff';

interface NavItem {
  id: PageId;
  label: MessageKey;
  icon: typeof Users;
  need: Need;
}

export const NAV: Array<{ group: MessageKey; items: NavItem[] }> = [
  {
    group: 'nav.groupLive',
    items: [
      { id: 'dashboard', label: 'nav.dashboard', icon: LayoutDashboard, need: 'any' },
      { id: 'users', label: 'nav.users', icon: Users, need: 'any' },
      { id: 'activations', label: 'nav.activations', icon: Zap, need: 'any' },
      { id: 'sessions', label: 'nav.sessions', icon: Activity, need: 'any' },
      { id: 'history', label: 'nav.history', icon: History, need: 'any' },
    ],
  },
  {
    group: 'nav.groupConfig',
    items: [
      { id: 'routers', label: 'nav.routers', icon: Server, need: 'configure' },
      { id: 'profiles', label: 'nav.profiles', icon: Layers, need: 'configure' },
      { id: 'limitations', label: 'nav.limitations', icon: Gauge, need: 'configure' },
      { id: 'links', label: 'nav.links', icon: Link2, need: 'configure' },
    ],
  },
  {
    group: 'nav.groupSystem',
    items: [
      { id: 'vouchers', label: 'nav.vouchers', icon: Ticket, need: 'operate' },
      { id: 'financials', label: 'nav.financials', icon: Wallet, need: 'finance' },
      { id: 'staff', label: 'nav.staff', icon: UserCog, need: 'staff' },
      { id: 'settings', label: 'nav.settings', icon: Settings, need: 'any' },
    ],
  },
];

const BOTTOM: PageId[] = ['dashboard', 'users', 'activations', 'sessions'];

export function allowed(role: Parameters<typeof can>[0], need: Need): boolean {
  return need === 'any' || can(role, need);
}

export function pageAllowed(role: Parameters<typeof can>[0], page: PageId): boolean {
  for (const g of NAV) for (const i of g.items) if (i.id === page) return allowed(role, i.need);
  return false;
}

export function Shell(props: { children: ReactNode }) {
  const { t } = useI18n();
  const { page, go, role, session, settings, routerStatus, checkRouter, signOut } = useApp();
  const [drawer, setDrawer] = useState(false);
  useBackHandler(drawer, () => setDrawer(false));

  const navigate = (id: PageId) => {
    go(id);
    setDrawer(false);
    window.scrollTo({ top: 0 });
  };
  const items = NAV.flatMap((g) => g.items);
  const current = items.find((i) => i.id === page);

  return (
    <div className="shell">
      <header className="topbar">
        <button className="icon-btn" onClick={() => setDrawer(true)} aria-label={t('c.more')}>
          <Menu size={22} />
        </button>
        <div className="topbar-title">
          {settings.logo ? <img src={settings.logo} alt="" className="topbar-logo" /> : null}
          <div>
            <strong>{current ? t(current.label) : settings.networkName}</strong>
            <small>{settings.networkName}</small>
          </div>
        </div>
        <button className={`status-dot ${routerStatus}`} onClick={() => void checkRouter()} aria-label={t(`st.${routerStatus}`)} title={t(`st.${routerStatus}`)}>
          <span />
        </button>
      </header>

      {!settings.secure && (
        <div className="insecure-banner" role="alert">
          <ShieldAlert size={16} /> {t('st.insecure')}
        </div>
      )}
      {routerStatus === 'offline' && <div className="offline-banner">{t('st.offline')}</div>}

      <main className="content">{props.children}</main>

      <nav className="bottom-nav" aria-label="main">
        {BOTTOM.map((id) => {
          const it = items.find((i) => i.id === id)!;
          const Icon = it.icon;
          return (
            <button key={id} className={page === id ? 'on' : ''} onClick={() => navigate(id)}>
              <Icon size={22} />
              <span>{t(it.label)}</span>
            </button>
          );
        })}
        <button className={!BOTTOM.includes(page) ? 'on' : ''} onClick={() => setDrawer(true)}>
          <MoreHorizontal size={22} />
          <span>{t('c.more')}</span>
        </button>
      </nav>

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(false)}>
          <aside className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <div className="avatar">{(session?.identity.username ?? '?').slice(0, 1).toUpperCase()}</div>
              <div className="drawer-user">
                <strong dir="ltr">{session?.identity.username}</strong>
                <small>{t(`role.${role}`)}</small>
              </div>
              <button className="icon-btn" onClick={() => setDrawer(false)} aria-label={t('c.close')}>
                <X size={20} />
              </button>
            </div>
            <nav className="drawer-nav">
              {NAV.map((g) => {
                const visible = g.items.filter((i) => allowed(role, i.need));
                if (!visible.length) return null;
                return (
                  <div key={g.group}>
                    <p className="drawer-group">{t(g.group)}</p>
                    {visible.map((i) => {
                      const Icon = i.icon;
                      return (
                        <button key={i.id} className={page === i.id ? 'on' : ''} onClick={() => navigate(i.id)}>
                          <Icon size={20} />
                          <span>{t(i.label)}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </nav>
            <button className="drawer-logout" onClick={() => signOut()}>
              <LogOut size={20} /> {t('nav.logout')}
            </button>
          </aside>
        </div>
      )}

    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((x) => (
        <div key={x.id} className={`toast ${x.kind}`} role={x.kind === 'error' ? 'alert' : 'status'} onClick={() => dismissToast(x.id)}>
          {x.text}
        </div>
      ))}
    </div>
  );
}
