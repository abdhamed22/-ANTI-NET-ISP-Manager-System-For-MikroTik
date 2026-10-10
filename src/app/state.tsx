import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RouterClient } from '../core/routeros/client.ts';
import type { Transport } from '../core/routeros/transport.ts';
import type { Identity, Role } from '../core/staff.ts';
import { saveSettings, type AppSettings } from '../core/settings.ts';
import type { KeyValueStore, SecretStore } from '../core/store.ts';
import { Ledger } from '../core/ledger.ts';
import { VoucherStore } from '../core/vouchers.ts';
import { fetchResource } from '../core/um.ts';

export type PageId =
  | 'dashboard'
  | 'users'
  | 'activations'
  | 'sessions'
  | 'history'
  | 'routers'
  | 'profiles'
  | 'limitations'
  | 'links'
  | 'vouchers'
  | 'financials'
  | 'staff'
  | 'settings';

export interface Session {
  client: RouterClient;
  identity: Identity;
}

export type RouterStatus = 'online' | 'offline' | 'checking';
export type ToastKind = 'ok' | 'error' | 'info';
export interface Toast {
  id: number;
  text: string;
  kind: ToastKind;
}

interface AppValue {
  settings: AppSettings;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  session: Session | null;
  role: Role;
  signIn: (s: Session) => void;
  signOut: (reason?: string) => void;
  signOutReason: string | null;
  kv: KeyValueStore;
  secrets: SecretStore;
  transport: Transport;
  ledger: Ledger;
  vouchers: VoucherStore;
  page: PageId;
  go: (p: PageId) => void;
  routerStatus: RouterStatus;
  checkRouter: () => Promise<void>;
  toasts: Toast[];
  toast: (text: string, kind?: ToastKind) => void;
  dismissToast: (id: number) => void;
}

const AppContext = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const v = useContext(AppContext);
  if (!v) throw new Error('AppContext missing');
  return v;
}

/** The signed-in client. Only use inside pages rendered after login. */
export function useClient(): RouterClient {
  const { session } = useApp();
  if (!session) throw new Error('not signed in');
  return session.client;
}

export function AppProvider(props: {
  initialSettings: AppSettings;
  kv: KeyValueStore;
  secrets: SecretStore;
  transport: Transport;
  children: ReactNode;
}) {
  const { kv, secrets, transport } = props;
  const [settings, setSettings] = useState(props.initialSettings);
  const [session, setSession] = useState<Session | null>(null);
  const [signOutReason, setSignOutReason] = useState<string | null>(null);
  const [page, setPage] = useState<PageId>('dashboard');
  const [routerStatus, setRouterStatus] = useState<RouterStatus>('checking');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const ledger = useMemo(() => new Ledger(kv), [kv]);
  const vouchers = useMemo(() => new VoucherStore(kv), [kv]);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const updateSettings = useCallback(
    async (patch: Partial<AppSettings>) => {
      const next = { ...settingsRef.current, ...patch };
      settingsRef.current = next;
      setSettings(next);
      await saveSettings(kv, next);
    },
    [kv],
  );

  const dismissToast = useCallback((id: number) => setToasts((list) => list.filter((x) => x.id !== id)), []);
  const toast = useCallback(
    (text: string, kind: ToastKind = 'ok') => {
      const id = ++toastId.current;
      setToasts((list) => [...list.slice(-1), { id, text, kind }]);
      setTimeout(() => dismissToast(id), kind === 'error' ? 6000 : 3000);
    },
    [dismissToast],
  );

  const signIn = useCallback((s: Session) => {
    setSignOutReason(null);
    setSession(s);
    setPage('dashboard');
    setRouterStatus('online');
  }, []);

  const signOut = useCallback((reason?: string) => {
    setSession(null);
    setSignOutReason(reason ?? null);
    setPage('dashboard');
  }, []);

  const checkRouter = useCallback(async () => {
    if (!session) return;
    setRouterStatus((s) => (s === 'online' ? s : 'checking'));
    try {
      await fetchResource(session.client);
      setRouterStatus('online');
    } catch {
      setRouterStatus('offline');
    }
  }, [session]);

  // Light heartbeat so the header shows when the router drops.
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(checkRouter, 30_000);
    return () => clearInterval(timer);
  }, [session, checkRouter]);

  const value: AppValue = {
    settings,
    updateSettings,
    session,
    role: session?.identity.role ?? 'viewer',
    signIn,
    signOut,
    signOutReason,
    kv,
    secrets,
    transport,
    ledger,
    vouchers,
    page,
    go: setPage,
    routerStatus,
    checkRouter,
    toasts,
    toast,
    dismissToast,
  };
  return <AppContext.Provider value={value}>{props.children}</AppContext.Provider>;
}
