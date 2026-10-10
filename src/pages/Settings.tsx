import { useState } from 'react';
import { DatabaseBackup, Eraser, ImagePlus, KeyRound, LogOut, Upload } from 'lucide-react';
import { useApp } from '../app/state.tsx';
import { useAction } from '../app/useAction.ts';
import { errorMessage, useI18n, type MessageKey } from '../i18n/index.tsx';
import { baseUrl } from '../core/routeros/client.ts';
import { can, changeOwnPassword } from '../core/staff.ts';
import { MAX_LOGO_CHARS, rememberPassword, type Currency, type Language } from '../core/settings.ts';
import { exportBackup, parseBackup, restoreBackup, wipeUserManager, type BackupFile } from '../core/backup.ts';
import { pickTextFile, savePrivateCopy, shareFile, stamp } from '../core/platform/files.ts';
import { vSecret } from '../core/validate.ts';
import { formatDateTime } from '../core/time.ts';
import { Field, Notice, PageHeader, Segmented, SelectField, Sheet, Toggle, confirm } from '../ui/components.tsx';

const APP_VERSION = '2.0.0';

async function pickLogo(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        const img = new Image();
        img.src = URL.createObjectURL(file);
        await img.decode();
        const scale = Math.min(1, 256 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        const url = canvas.toDataURL('image/png');
        resolve(url.length <= MAX_LOGO_CHARS ? url : canvas.toDataURL('image/jpeg', 0.85));
      } catch {
        resolve(null);
      }
    };
    input.click();
  });
}

export function Settings() {
  const { t, locale } = useI18n();
  const app = useApp();
  const { settings, updateSettings, session, role, signOut, toast } = app;
  const admin = can(role, 'configure');
  const [networkName, setNetworkName] = useState(settings.networkName);
  const [pw, setPw] = useState({ old: '', next: '', again: '' });
  const [pwTouched, setPwTouched] = useState(false);
  const [restore, setRestore] = useState<BackupFile | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const { busy, run } = useAction();

  const pwErr = {
    old: (pw.old ? null : 'v.required') as MessageKey | null,
    next: (vSecret(pw.next, 8) ?? (pw.next === session?.identity.username ? 'v.passwordSameAsUser' : null)) as MessageKey | null,
    again: (pw.again === pw.next ? null : 'v.passwordMismatch') as MessageKey | null,
  };

  const changePassword = async () => {
    setPwTouched(true);
    if (!session || Object.values(pwErr).some(Boolean)) return;
    const ok = await run(() => changeOwnPassword(session.client, pw.old, pw.next));
    if (ok) {
      await rememberPassword(app.secrets, null);
      await updateSettings({ rememberPassword: false });
      signOut(t('set.passwordChanged'));
    }
  };

  const doExport = async () => {
    if (!session) return;
    await run(async () => {
      const file = await exportBackup(session.client, await app.vouchers.all(), await app.ledger.all(), session.identity.username);
      await shareFile(`antinet-backup-${stamp()}.json`, JSON.stringify(file, null, 1), 'application/json');
    });
  };

  const doImport = async () => {
    const text = await pickTextFile();
    if (!text) return;
    try {
      setRestore(parseBackup(text));
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    }
  };

  return (
    <div className="page">
      <PageHeader title={t('set.title')} />

      <section className="card">
        <div className="field">
          <label>{t('set.language')}</label>
          <Segmented<Language>
            value={settings.language}
            onChange={(language) => void updateSettings({ language })}
            options={[
              { value: 'ar', label: 'العربية' },
              { value: 'en', label: 'English' },
            ]}
          />
        </div>
        <SelectField
          label={t('set.autoLock')}
          value={String(settings.autoLockMinutes)}
          onChange={(v) => void updateSettings({ autoLockMinutes: Number(v) })}
          options={[
            { value: '2', label: '2' },
            { value: '5', label: '5' },
            { value: '10', label: '10' },
            { value: '30', label: '30' },
            { value: '0', label: t('set.autoLockNever') },
          ]}
        />
      </section>

      {admin && (
        <section className="card">
          <Field
            label={t('set.network')}
            value={networkName}
            onChange={setNetworkName}
            suffix={
              networkName !== settings.networkName && networkName.trim() ? (
                <button className="btn small primary" onClick={() => void updateSettings({ networkName: networkName.trim().slice(0, 40) })}>
                  {t('c.save')}
                </button>
              ) : undefined
            }
          />
          <SelectField
            label={t('set.currency')}
            value={settings.currency}
            onChange={(v) => void updateSettings({ currency: v as Currency })}
            options={[
              { value: 'IQD', label: 'IQD — دينار عراقي' },
              { value: 'USD', label: 'USD — $' },
              { value: 'EUR', label: 'EUR — €' },
              { value: 'GBP', label: 'GBP — £' },
            ]}
          />
          <div className="field">
            <label>{t('set.logo')}</label>
            <div className="logo-row">
              {settings.logo && <img src={settings.logo} alt="" className="logo-preview" />}
              <button
                className="btn small"
                onClick={async () => {
                  const logo = await pickLogo();
                  if (logo) await updateSettings({ logo });
                }}
              >
                <ImagePlus size={16} /> {t('set.logoPick')}
              </button>
              {settings.logo && (
                <button className="btn small ghost" onClick={() => void updateSettings({ logo: '' })}>
                  {t('set.logoRemove')}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <h3>
          <KeyRound size={18} /> {t('set.changePassword')}
        </h3>
        <Field label={t('set.oldPassword')} value={pw.old} onChange={(old) => setPw({ ...pw, old })} type="password" ltr error={pwTouched ? pwErr.old : null} autoComplete="current-password" />
        <Field label={t('set.newPassword')} value={pw.next} onChange={(next) => setPw({ ...pw, next })} type="password" ltr error={pwTouched ? pwErr.next : null} autoComplete="new-password" />
        <Field label={t('set.newPassword2')} value={pw.again} onChange={(again) => setPw({ ...pw, again })} type="password" ltr error={pwTouched ? pwErr.again : null} autoComplete="new-password" />
        <button className="btn primary" onClick={() => void changePassword()} disabled={busy}>
          {t('c.save')}
        </button>
      </section>

      {admin && (
        <section className="card">
          <h3>
            <DatabaseBackup size={18} /> {t('set.backup')}
          </h3>
          <Notice kind="warn">{t('set.backupWarn')}</Notice>
          <div className="btn-row">
            <button className="btn" onClick={() => void doExport()} disabled={busy}>
              <DatabaseBackup size={16} /> {t('set.backupExport')}
            </button>
            <button className="btn" onClick={() => void doImport()} disabled={busy}>
              <Upload size={16} /> {t('set.backupImport')}
            </button>
          </div>
          <p className="small muted">{t('set.legacyNote')}</p>
        </section>
      )}

      {admin && (
        <section className="card danger-zone">
          <h3>
            <Eraser size={18} /> {t('set.reset')}
          </h3>
          <p className="small">{t('set.resetBody')}</p>
          <button className="btn danger" onClick={() => setResetOpen(true)}>
            {t('set.reset')}
          </button>
        </section>
      )}

      <section className="card">
        <h3>{t('set.connection')}</h3>
        {session && (
          <p className="small" dir="auto">
            {t('set.connectionInfo', { url: baseUrl(session.client.endpoint), user: session.identity.username, role: t(`role.${role}`) })}
          </p>
        )}
        <button className="btn ghost" onClick={() => signOut()}>
          <LogOut size={16} /> {t('nav.logout')}
        </button>
        <p className="small muted">{t('set.version', { v: APP_VERSION })}</p>
      </section>

      {restore && <RestoreSheet file={restore} onClose={() => setRestore(null)} locale={locale} />}
      {resetOpen && <ResetSheet onClose={() => setResetOpen(false)} />}
    </div>
  );
}

function RestoreSheet(props: { file: BackupFile; onClose: () => void; locale: string }) {
  const { t } = useI18n();
  const { session, vouchers, ledger, toast } = useApp();
  const [overwrite, setOverwrite] = useState(false);
  const [subs, setSubs] = useState(false);
  const [local, setLocal] = useState(true);
  const [progress, setProgress] = useState('');
  const { busy, run } = useAction();
  const counts = Object.entries(props.file.router).map(([k, v]) => `${k}: ${v.length}`).join(' · ');

  const go = async () => {
    if (!session) return;
    await run(async () => {
      const report = await restoreBackup(session.client, props.file, { overwrite, subscriptions: subs }, (resource, done, total) =>
        setProgress(`${resource} ${done}/${total}`),
      );
      if (local) {
        await vouchers.merge(props.file.local.vouchers);
        await ledger.merge(props.file.local.sales);
      }
      toast(
        t('set.restoreDone', { created: report.created, updated: report.updated, skipped: report.skipped, failed: report.failed.length }),
        report.failed.length ? 'error' : 'ok',
      );
      props.onClose();
    });
    setProgress('');
  };

  return (
    <Sheet
      open
      title={t('set.restoreTitle')}
      onClose={props.onClose}
      busy={busy}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose} disabled={busy}>
            {t('c.cancel')}
          </button>
          <button className="btn primary" onClick={() => void go()} disabled={busy}>
            {busy ? progress || t('c.saving') : t('set.restoreRun')}
          </button>
        </>
      }
    >
      <p className="small">
        {t('set.restoreFrom', { date: formatDateTime(new Date(props.file.createdAt), props.locale), who: props.file.createdBy || '—' })}
      </p>
      <p className="small muted" dir="ltr">
        {counts}
      </p>
      <Notice>{t('set.restoreSafety')}</Notice>
      <Toggle label={t('set.restoreOverwrite')} checked={overwrite} onChange={setOverwrite} />
      <Toggle label={t('set.restoreSubs')} checked={subs} onChange={setSubs} />
      <Toggle label={t('set.restoreLocal')} checked={local} onChange={setLocal} />
    </Sheet>
  );
}

function ResetSheet(props: { onClose: () => void }) {
  const { t } = useI18n();
  const { session, vouchers, ledger, toast } = useApp();
  const [routers, setRouters] = useState(false);
  const { busy, run } = useAction();

  const go = async () => {
    if (!session) return;
    const ok = await confirm({ title: t('set.reset'), message: t('set.resetBody'), danger: true, typed: 'ERASE', confirmText: t('c.delete') });
    if (!ok) return;
    await run(async () => {
      // Safety copy first; if it cannot be written nothing is erased.
      const file = await exportBackup(session.client, await vouchers.all(), await ledger.all(), session.identity.username);
      const path = await savePrivateCopy(`before-erase-${stamp()}.json`, JSON.stringify(file));
      await wipeUserManager(session.client, routers);
      toast(t('set.resetDone', { file: path }), 'ok');
      props.onClose();
    });
  };

  return (
    <Sheet
      open
      title={t('set.reset')}
      onClose={props.onClose}
      busy={busy}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose} disabled={busy}>
            {t('c.cancel')}
          </button>
          <button className="btn danger" onClick={() => void go()} disabled={busy}>
            {busy ? t('c.saving') : t('set.reset')}
          </button>
        </>
      }
    >
      <Notice kind="danger">{t('set.resetBody')}</Notice>
      <Toggle label={t('set.resetRouters')} checked={routers} onChange={setRouters} />
    </Sheet>
  );
}
