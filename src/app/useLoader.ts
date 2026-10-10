import { useCallback, useEffect, useRef, useState } from 'react';
import { RouterError, type RouterClient } from '../core/routeros/client.ts';
import { useApp } from './state.tsx';
import { errorMessage, useI18n } from '../i18n/index.tsx';

export interface Loaded<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  reload: (quiet?: boolean) => Promise<void>;
}

/**
 * Loads data from the router for a page. Signs the user out if the router
 * rejects the credentials (password changed or account disabled meanwhile).
 */
export function useLoader<T>(fn: (client: RouterClient) => Promise<T>, deps: unknown[] = [], intervalMs = 0): Loaded<T> {
  const { session, signOut } = useApp();
  const { t } = useI18n();
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const seq = useRef(0);

  const reload = useCallback(
    async (quiet = false) => {
      if (!session) return;
      const mine = ++seq.current;
      if (!quiet) setLoading(true);
      try {
        const result = await fnRef.current(session.client);
        if (mine !== seq.current) return;
        setData(result);
        setError(null);
      } catch (e) {
        if (mine !== seq.current) return;
        if (e instanceof RouterError && e.kind === 'auth') {
          signOut(t('e.auth'));
          return;
        }
        setError(errorMessage(t, e));
      } finally {
        if (mine === seq.current) setLoading(false);
      }
    },
    [session, signOut, t, ...deps],
  );

  useEffect(() => {
    void reload();
    const timer = intervalMs
      ? setInterval(() => {
          if (document.visibilityState === 'visible') void reload(true);
        }, intervalMs)
      : undefined;
    return () => {
      if (timer) clearInterval(timer);
      // Results of requests started for the previous dependencies are dropped.
      seq.current++;
    };
  }, [reload, intervalMs]);

  return { data, error, loading, reload };
}
