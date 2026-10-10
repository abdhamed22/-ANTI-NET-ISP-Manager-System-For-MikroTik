import { useEffect, useState } from 'react';
import { ChevronDown, Fingerprint, Languages, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useApp } from '../app/state.tsx';
import { errorMessage, useI18n, type MessageKey } from '../i18n/index.tsx';
import { RouterClient, isValidHost } from '../core/routeros/client.ts';
import { formatFingerprint, type CertificateInfo } from '../core/routeros/transport.ts';
import { identify } from '../core/staff.ts';
import { loadRememberedPassword, rememberPassword } from '../core/settings.ts';
import { vPort } from '../core/validate.ts';
import { CopyButton, Field, Notice, Segmented, Sheet, Toggle } from '../ui/components.tsx';

const SETUP_COMMANDS = `/user-manager set enabled=yes
/certificate add name=antinet-https common-name=antinet-router days-valid=3650 key-usage=digital-signature,key-encipherment,tls-server
/certificate sign antinet-https
/ip service set www-ssl certificate=antinet-https disabled=no address=192.168.88.0/24
/certificate print detail where name=antinet-https`;

export function Login() {
  const { t } = useI18n();
  const app = useApp();
  const { settings, updateSettings, transport, secrets } = app;
  const [host, setHost] = useState(settings.host);
  const [secure, setSecure] = useState(settings.secure);
  const [port, setPort] = useState(String(settings.port));
  const [username, setUsername] = useState(settings.lastUsername);
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(settings.rememberPassword);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(app.signOutReason);
  const [showConn, setShowConn] = useState(!settings.lastUsername || (settings.secure && !settings.pinSha256));
  const [cert, setCert] = useState<CertificateInfo | null>(null);
  const [probing, setProbing] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    if (!settings.rememberPassword) return;
    void loadRememberedPassword(secrets).then((p) => {
      if (p) setPassword(p);
    });
    // Only on first render: later edits of the field must not be overwritten.
  }, []);

  const portNum = Number(port);
  const hostError: MessageKey | null = !host.trim() ? 'v.required' : isValidHost(host) ? null : 'v.ip';
  const portError = vPort(port) as MessageKey | null;
  const samePinTarget = settings.host === host.trim() && settings.port === portNum && settings.secure;
  const pin = secure && samePinTarget ? settings.pinSha256 : '';

  const setProtocol = (s: boolean) => {
    setSecure(s);
    if (port === '443' || port === '80' || !port) setPort(s ? '443' : '80');
  };

  const probe = async () => {
    if (hostError || portError) return;
    setProbing(true);
    setError(null);
    try {
      setCert(await transport.probeCertificate(host.trim(), portNum));
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setProbing(false);
    }
  };

  const trust = async () => {
    if (!cert) return;
    const accepted = cert.sha256;
    await updateSettings({ host: host.trim(), port: portNum, secure: true, pinSha256: accepted });
    setCert(null);
    if (username.trim() && password) await submit(accepted);
  };

  const submit = async (acceptedPin?: string) => {
    const usePin = acceptedPin ?? pin;
    setError(null);
    if (hostError || portError || !username.trim() || !password) {
      setShowConn(!!(hostError || portError));
      setError(t('v.required'));
      return;
    }
    if (secure && !usePin) {
      await probe();
      return;
    }
    setBusy(true);
    try {
      const client = new RouterClient(
        transport,
        { host: host.trim(), port: portNum, secure, pinSha256: usePin || undefined },
        { username: username.trim(), password },
      );
      const identity = await identify(client);
      await updateSettings({ host: host.trim(), port: portNum, secure, lastUsername: username.trim(), rememberPassword: remember && secrets.persistent });
      await rememberPassword(secrets, remember && secrets.persistent ? password : null);
      app.signIn({ client, identity });
    } catch (e) {
      setError(errorMessage(t, e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-top">
        <button
          className="btn ghost small"
          onClick={() => void updateSettings({ language: settings.language === 'ar' ? 'en' : 'ar' })}
          aria-label={t('set.language')}
        >
          <Languages size={16} /> {settings.language === 'ar' ? 'English' : 'العربية'}
        </button>
      </div>
      <div className="login-brand">
        {settings.logo ? <img src={settings.logo} alt="" /> : <div className="brand-mark">{settings.networkName.slice(0, 1)}</div>}
        <h1>{settings.networkName}</h1>
        <p className="muted">{t('app.subtitle')}</p>
      </div>

      <form
        className="card login-card"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2>{t('login.title')}</h2>
        <p className="muted small">{t('login.hint')}</p>
        <Field label={t('c.username')} value={username} onChange={setUsername} ltr autoComplete="username" />
        <Field label={t('c.password')} value={password} onChange={setPassword} type="password" ltr autoComplete="current-password" />
        {secrets.persistent && <Toggle label={t('login.remember')} checked={remember} onChange={setRemember} />}

        <button type="button" className="disclosure" onClick={() => setShowConn((s) => !s)} aria-expanded={showConn}>
          <span>
            {secure ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />} {t('login.router')}
          </span>
          <span dir="ltr" className="muted small">
            {secure ? 'https' : 'http'}://{host}:{port}
          </span>
          <ChevronDown size={18} className={showConn ? 'rot' : ''} />
        </button>

        {showConn && (
          <div className="conn">
            <Field label={t('login.host')} value={host} onChange={setHost} ltr inputMode="url" error={host ? hostError : null} />
            <div className="field">
              <label>{t('login.protocol')}</label>
              <Segmented
                value={secure ? 'https' : 'http'}
                onChange={(v) => setProtocol(v === 'https')}
                options={[
                  { value: 'https', label: t('login.https') },
                  { value: 'http', label: t('login.http') },
                ]}
              />
            </div>
            <Field label={t('login.port')} value={port} onChange={setPort} ltr inputMode="numeric" error={portError} />
            {secure ? (
              <div className="field">
                <label>{t('login.cert')}</label>
                <div className="cert-row">
                  <span dir="ltr" className={`small ${pin ? 'ok-text' : 'muted'}`}>
                    {pin ? t('login.certPinned', { fp: formatFingerprint(pin).slice(0, 23) + '…' }) : t('login.certNone')}
                  </span>
                  <button type="button" className="btn small" onClick={() => void probe()} disabled={probing}>
                    <Fingerprint size={16} /> {probing ? t('login.verifying') : t('login.verify')}
                  </button>
                </div>
              </div>
            ) : (
              <Notice kind="danger">
                <ShieldAlert size={18} /> <span>{t('login.httpWarning')}</span>
              </Notice>
            )}
          </div>
        )}

        {error && (
          <div className="notice danger" role="alert">
            <ShieldAlert size={18} />
            <p>{error}</p>
          </div>
        )}

        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? t('login.signingIn') : t('login.submit')}
        </button>
      </form>

      <button className="disclosure plain" onClick={() => setHelp((h) => !h)} aria-expanded={help}>
        <span>{t('login.setupHelp')}</span>
        <ChevronDown size={18} className={help ? 'rot' : ''} />
      </button>
      {help && (
        <div className="card help">
          <p className="small">{t('login.setupBody')}</p>
          <div className="code-block">
            <pre dir="ltr">{SETUP_COMMANDS}</pre>
            <CopyButton text={SETUP_COMMANDS} />
          </div>
          <p className="small muted">{t('login.setupNote')}</p>
        </div>
      )}

      <Sheet
        open={!!cert}
        title={t('login.certTitle')}
        onClose={() => setCert(null)}
        footer={
          <>
            <button className="btn ghost" onClick={() => setCert(null)}>
              {t('c.cancel')}
            </button>
            <button className="btn primary" onClick={() => void trust()}>
              {t('login.trust')}
            </button>
          </>
        }
      >
        {cert && (
          <div className="cert">
            <p className="small">{t('login.certBody')}</p>
            <p className="fingerprint" dir="ltr">
              {formatFingerprint(cert.sha256)}
            </p>
            <dl>
              <dt>{t('login.certSubject')}</dt>
              <dd dir="ltr">{cert.subject || '—'}</dd>
              <dt>{t('login.certValid')}</dt>
              <dd dir="ltr">{cert.validTo || '—'}</dd>
            </dl>
            <pre dir="ltr" className="code-inline">
              /certificate print detail
            </pre>
          </div>
        )}
      </Sheet>
    </div>
  );
}
