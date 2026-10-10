import { useCallback, useState } from 'react';
import { RouterError } from '../core/routeros/client.ts';
import { useApp } from './state.tsx';
import { errorMessage, useI18n } from '../i18n/index.tsx';

/**
 * Wraps a change on the router: tracks busy state, shows a toast on success,
 * and a translated error toast on failure. Returns true when it succeeded.
 */
export function useAction() {
  const { toast, signOut } = useApp();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (fn: () => Promise<unknown>, success?: string): Promise<boolean> => {
      setBusy(true);
      try {
        await fn();
        if (success) toast(success, 'ok');
        return true;
      } catch (e) {
        if (e instanceof RouterError && e.kind === 'auth') signOut(t('e.auth'));
        else toast(errorMessage(t, e), 'error');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast, signOut, t],
  );

  return { busy, run };
}
