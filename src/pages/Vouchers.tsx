import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckSquare, Printer, Rocket, Trash2, X } from 'lucide-react';
import { useApp } from '../app/state.tsx';
import { useLoader } from '../app/useLoader.ts';
import { useAction } from '../app/useAction.ts';
import { errorMessage, useI18n, type MessageKey } from '../i18n/index.tsx';
import { PATHS, profilePrice } from '../core/um.ts';
import { VOUCHER_LIMITS, generateBatch, provisionVouchers, type Voucher, type VoucherStatus } from '../core/vouchers.ts';
import { formatMoney } from '../core/settings.ts';
import { formatAttributes, vAttributes, vIntRange, vName, type Attribute } from '../core/validate.ts';
import { shareFile, stamp } from '../core/platform/files.ts';
import { AttributesEditor } from '../ui/AttributesEditor.tsx';
import { vouchersToPdf } from '../ui/voucherSheet.ts';
import { Badge, CopyButton, Empty, Fab, Field, Notice, PageHeader, SearchBar, Segmented, SelectField, Sheet, confirm, matches } from '../ui/components.tsx';

type Filter = VoucherStatus | 'all';

export function Vouchers() {
  const { t, lang } = useI18n();
  const { vouchers, ledger, session, settings, toast } = useApp();
  const [list, setList] = useState<Voucher[]>([]);
  const [filter, setFilter] = useState<Filter>('stock');
  const [q, setQ] = useState('');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [printing, setPrinting] = useState(false);
  const profiles = useLoader((c) => c.list(PATHS.profiles));
  const { busy, run } = useAction();

  const refresh = useCallback(async () => setList([...(await vouchers.all())]), [vouchers]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shown = useMemo(
    () => list.filter((v) => filter === 'all' || v.status === filter).filter((v) => matches(q, v.username, v.profile)),
    [list, filter, q],
  );
  const counts = useMemo(() => {
    const c = { stock: 0, provisioned: 0, failed: 0 };
    for (const v of list) c[v.status]++;
    return c;
  }, [list]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const endSelection = () => {
    setSelected(new Set());
    setSelecting(false);
  };

  const push = async (ids: string[]) => {
    if (!session) return;
    const targets = list.filter((v) => ids.includes(v.id) && v.status !== 'provisioned');
    if (!targets.length) return;
    if (!(await confirm({ title: t('vc.push'), message: t('vc.pushConfirm', { n: targets.length }), confirmText: t('vc.push') }))) return;
    setProgress({ done: 0, total: targets.length });
    try {
      const res = await provisionVouchers(session.client, vouchers, ledger, targets.map((v) => v.id), session.identity.username, (done, total) =>
        setProgress({ done, total }),
      );
      toast(t('vc.pushResult', { ok: res.ok, failed: res.failed.length }), res.failed.length ? 'error' : 'ok');
      endSelection();
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    } finally {
      setProgress(null);
      await refresh();
    }
  };

  const remove = async (ids: string[]) => {
    if (!ids.length) return;
    if (!(await confirm({ title: t('c.delete'), message: t('c.deleteMany', { n: ids.length }), danger: true, confirmText: t('c.delete') }))) return;
    await vouchers.remove(ids);
    endSelection();
    await refresh();
  };

  const print = async () => {
    const pick = selected.size ? list.filter((v) => selected.has(v.id)) : shown;
    if (!pick.length) {
      toast(t('vc.noneToPrint'), 'info');
      return;
    }
    setPrinting(true);
    try {
      const rows = profiles.data ?? [];
      const pdf = await vouchersToPdf(pick, {
        networkName: settings.networkName,
        logo: settings.logo,
        userLabel: t('vc.card.user'),
        passLabel: t('vc.card.pass'),
        rtl: lang === 'ar',
        priceOf: (p) => (rows.length ? formatMoney(profilePrice(rows, p), settings.currency) : ''),
      });
      await shareFile(`vouchers-${stamp()}.pdf`, pdf, 'application/pdf');
    } catch (e) {
      toast(errorMessage(t, e), 'error');
    } finally {
      setPrinting(false);
    }
  };

  const tone = (s: VoucherStatus) => (s === 'stock' ? 'warn' : s === 'provisioned' ? 'ok' : 'danger');
  const label = (s: VoucherStatus): MessageKey => (s === 'stock' ? 'vc.stock' : s === 'provisioned' ? 'vc.provisioned' : 'vc.failed');

  return (
    <div className="page">
      <PageHeader
        title={t('nav.vouchers')}
        actions={
          <>
            <button className="icon-btn" onClick={() => void print()} disabled={printing} aria-label={t('vc.print')}>
              <Printer size={20} className={printing ? 'pulse' : ''} />
            </button>
            <button className={`icon-btn ${selecting ? 'on' : ''}`} onClick={() => (selecting ? endSelection() : setSelecting(true))} aria-label={t('c.selectAll')}>
              {selecting ? <X size={20} /> : <CheckSquare size={20} />}
            </button>
          </>
        }
      />
      <Notice>{t('vc.localNote')}</Notice>
      <Segmented
        value={filter}
        onChange={(f) => {
          setFilter(f);
          setSelected(new Set());
        }}
        options={[
          { value: 'stock', label: `${t('vc.stock')} ${counts.stock}` },
          { value: 'provisioned', label: `${t('vc.provisioned')} ${counts.provisioned}` },
          { value: 'failed', label: `${t('vc.failed')} ${counts.failed}` },
          { value: 'all', label: t('act.filterAll') },
        ]}
      />
      <SearchBar value={q} onChange={setQ} />
      {selecting && (
        <div className="selection-bar">
          <span>{t('c.selected', { n: selected.size })}</span>
          <button className="btn small ghost" onClick={() => setSelected(new Set(shown.map((v) => v.id)))}>
            {t('c.selectAll')}
          </button>
          <button className="btn small primary" disabled={!selected.size || !!progress} onClick={() => void push([...selected])}>
            <Rocket size={14} /> {t('vc.push')}
          </button>
          <button className="icon-btn danger" disabled={!selected.size} onClick={() => void remove([...selected])} aria-label={t('c.delete')}>
            <Trash2 size={18} />
          </button>
        </div>
      )}
      {progress && (
        <div className="progress-card" role="status">
          <span>{t('vc.pushing', { done: progress.done, total: progress.total })}</span>
          <div className="meter-bar">
            <span className="ok" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </div>
        </div>
      )}
      <ul className="cards">
        {shown.slice(0, 500).map((v) => (
          <li key={v.id} className={`item ${selected.has(v.id) ? 'selected' : ''}`} onClick={() => selecting && toggle(v.id)}>
            {selecting && <input type="checkbox" checked={selected.has(v.id)} readOnly aria-label={v.username} />}
            <div className="item-main">
              <div className="item-title">
                <strong dir="ltr">{v.username}</strong>
                <Badge tone={tone(v.status)}>{t(label(v.status))}</Badge>
              </div>
              <div className="item-sub">
                <span className="mono" dir="ltr">
                  {v.password}
                </span>
                <CopyButton text={`${v.username} / ${v.password}`} />
                <span dir="ltr">{v.profile}</span>
              </div>
              {v.error && <small className="error-text" dir="ltr">{v.error}</small>}
            </div>
            {!selecting && v.status !== 'provisioned' && (
              <div className="item-actions">
                <button className="btn small" onClick={() => void push([v.id])} disabled={!!progress}>
                  <Rocket size={14} /> {t('vc.push')}
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {shown.length === 0 && <Empty text={q ? t('c.noMatch') : t('c.empty')} />}
      <Fab label={t('vc.generate')} onClick={() => setGenerating(true)} />
      {generating && session && (
        <GenerateSheet
          profiles={(profiles.data ?? []).map((p) => p.name ?? '')}
          busy={busy}
          onClose={() => setGenerating(false)}
          onGenerate={async (opts) => {
            const ok = await run(async () => {
              const routerNames = (await session.client.list(PATHS.users)).map((u) => u.name ?? '');
              const taken = new Set([...routerNames, ...list.map((v) => v.username)]);
              const batch = generateBatch(opts, taken);
              await vouchers.add(batch);
              await refresh();
              toast(t('vc.generated', { n: batch.length }), 'ok');
            });
            if (ok) {
              setGenerating(false);
              setFilter('stock');
            }
          }}
        />
      )}
    </div>
  );
}

function GenerateSheet(props: {
  profiles: string[];
  busy: boolean;
  onClose: () => void;
  onGenerate: (o: { quantity: number; profile: string; prefix: string; length: number; attributes: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [qty, setQty] = useState('50');
  const [profile, setProfile] = useState('');
  const [prefix, setPrefix] = useState('');
  const [len, setLen] = useState('8');
  const [attrs, setAttrs] = useState<Attribute[]>([]);
  const [touched, setTouched] = useState(false);
  const e = {
    qty: vIntRange(qty, VOUCHER_LIMITS.minQty, VOUCHER_LIMITS.maxQty) as MessageKey | null,
    profile: (profile ? null : 'v.required') as MessageKey | null,
    prefix: (prefix ? vName(prefix) : null) as MessageKey | null,
    len: vIntRange(len, VOUCHER_LIMITS.minLen, VOUCHER_LIMITS.maxLen) as MessageKey | null,
    attrs: vAttributes(attrs) as MessageKey | null,
  };
  const invalid = Object.values(e).some(Boolean);
  const show = (k: keyof typeof e) => (touched ? e[k] : null);
  return (
    <Sheet
      open
      title={t('vc.generate')}
      onClose={props.onClose}
      busy={props.busy}
      footer={
        <>
          <button className="btn ghost" onClick={props.onClose} disabled={props.busy}>
            {t('c.cancel')}
          </button>
          <button
            className="btn primary"
            disabled={props.busy}
            onClick={() => {
              setTouched(true);
              if (!invalid) void props.onGenerate({ quantity: Number(qty), profile, prefix: prefix.trim(), length: Number(len), attributes: formatAttributes(attrs) });
            }}
          >
            {props.busy ? t('c.saving') : t('c.generate')}
          </button>
        </>
      }
    >
      <SelectField
        label={t('act.profile')}
        value={profile}
        onChange={setProfile}
        placeholder={t('act.choose')}
        options={props.profiles.map((p) => ({ value: p, label: p }))}
        error={show('profile')}
      />
      <div className="row2">
        <Field label={t('vc.quantity')} value={qty} onChange={setQty} ltr inputMode="numeric" error={show('qty')} hint={`${VOUCHER_LIMITS.minQty}–${VOUCHER_LIMITS.maxQty}`} />
        <Field label={t('vc.length')} value={len} onChange={setLen} ltr inputMode="numeric" error={show('len')} hint={`${VOUCHER_LIMITS.minLen}–${VOUCHER_LIMITS.maxLen}`} />
      </div>
      <Field label={`${t('vc.prefix')} (${t('c.optional')})`} value={prefix} onChange={setPrefix} ltr error={show('prefix')} placeholder="NET-" />
      <AttributesEditor value={attrs} onChange={setAttrs} error={show('attrs') ? t(e.attrs!) : null} />
    </Sheet>
  );
}
