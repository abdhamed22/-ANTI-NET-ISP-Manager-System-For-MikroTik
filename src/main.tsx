import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from './app/state.tsx';
import { App } from './app/App.tsx';
import { createStores } from './core/platform/storage.ts';
import { createTransport } from './core/platform/routerlink.ts';
import { loadSettings } from './core/settings.ts';
import './styles.css';

async function boot() {
  const { kv, secrets } = createStores();
  const settings = await loadSettings(kv);
  document.documentElement.lang = settings.language;
  document.documentElement.dir = settings.language === 'ar' ? 'rtl' : 'ltr';
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AppProvider initialSettings={settings} kv={kv} secrets={secrets} transport={createTransport()}>
        <App />
      </AppProvider>
    </StrictMode>,
  );
}

void boot();
