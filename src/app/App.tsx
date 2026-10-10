import { useEffect, useRef } from 'react';
import { App as CapApp } from '@capacitor/app';
import { useApp, type PageId } from './state.tsx';
import { handleBack } from './back.ts';
import { I18nProvider } from '../i18n/index.tsx';
import { ConfirmHost } from '../ui/components.tsx';
import { Shell, Toasts, pageAllowed } from '../ui/Shell.tsx';
import { Login } from '../pages/Login.tsx';
import { Dashboard } from '../pages/Dashboard.tsx';
import { Users } from '../pages/Users.tsx';
import { Activations } from '../pages/Activations.tsx';
import { SessionHistory, Sessions } from '../pages/Sessions.tsx';
import { Limitations, ProfileLinks, Profiles, Routers } from '../pages/Config.tsx';
import { Vouchers } from '../pages/Vouchers.tsx';
import { Financials } from '../pages/Financials.tsx';
import { Staff } from '../pages/Staff.tsx';
import { Settings } from '../pages/Settings.tsx';

function Page({ id }: { id: PageId }) {
  switch (id) {
    case 'dashboard':
      return <Dashboard />;
    case 'users':
      return <Users />;
    case 'activations':
      return <Activations />;
    case 'sessions':
      return <Sessions />;
    case 'history':
      return <SessionHistory />;
    case 'routers':
      return <Routers />;
    case 'profiles':
      return <Profiles />;
    case 'limitations':
      return <Limitations />;
    case 'links':
      return <ProfileLinks />;
    case 'vouchers':
      return <Vouchers />;
    case 'financials':
      return <Financials />;
    case 'staff':
      return <Staff />;
    case 'settings':
      return <Settings />;
  }
}

export function App() {
  const { settings, session, page, go, role, signOut } = useApp();
  const pageRef = useRef(page);
  pageRef.current = page;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  useEffect(() => {
    const el = document.documentElement;
    el.lang = settings.language;
    el.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
  }, [settings.language]);

  // Android back button: close the top sheet, else go to the dashboard, else leave the app.
  useEffect(() => {
    const sub = CapApp.addListener('backButton', () => {
      if (handleBack()) return;
      if (sessionRef.current && pageRef.current !== 'dashboard') go('dashboard');
      else void CapApp.minimizeApp();
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, [go]);

  // Lock after the app spent too long in the background.
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const sub = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        hiddenAt.current = Date.now();
        return;
      }
      const minutes = settings.autoLockMinutes;
      if (hiddenAt.current && minutes > 0 && Date.now() - hiddenAt.current > minutes * 60_000 && sessionRef.current) signOut();
      hiddenAt.current = null;
    });
    return () => {
      void sub.then((h) => h.remove());
    };
  }, [settings.autoLockMinutes, signOut]);

  const visible: PageId = pageAllowed(role, page) ? page : 'dashboard';
  return (
    <I18nProvider lang={settings.language}>
      {session ? (
        <Shell>
          <Page key={visible} id={visible} />
        </Shell>
      ) : (
        <Login />
      )}
      <ConfirmHost />
      <Toasts />
    </I18nProvider>
  );
}
