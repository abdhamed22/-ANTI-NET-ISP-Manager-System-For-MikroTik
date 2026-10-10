import { useEffect, useMemo, useState } from 'react';
import { Download, Trash2 } from 'lucide-react';
import { useApp } from '../app/state.tsx';
import { useI18n, type MessageKey } from '../i18n/index.tsx';
import { salesToCsv, type Sale } from '../core/ledger.ts';
import { formatMoney } from '../core/settings.ts';
import { formatDateTime } from '../core/time.ts';
import { shareFile, stamp } from '../core/platform/files.ts';
import { Badge, Empty, Notice, PageHeader, SearchBar, Segmented, confirm, matches } from '../ui/components.tsx';

type Range = 'today' | 'week' | 'month' | 'all';

function since(range: Range): number {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === 'today') return startOfToday;
  if (range === 'week') return startOfToday - 6 * 86_400_000;
  if (range === 'month') return startOfToday - 29 * 86_400_000;
  return 0;
}

export function Financials() {
  const { t, locale } = useI18n();
  const { ledger, settings, toast } = useApp();
  const [sales, setSales] = useState<Sale[]>([]);
  const [range, setRange] = useState<Range>('today');
  const [q, setQ] = useState('');

  useEffect(() => {
    void ledger.all().then((s) => setSales([...s]));
  }, [ledger]);

  const shown = useMemo(() => {
    const from = since(range);
    return sales.filter((s) => new Date(s.at).getTime() >= from).filter((s) => matches(q, s.user, s.profile, s.actor));
  }, [sales, range, q]);
  const total = shown.reduce((sum, s) => sum + s.price, 0);

  const exportCsv = async () => {
    try {
      await shareFile(`sales-${stamp()}.csv`, salesToCsv(shown, settings.currency), 'text/csv');
    } catch (e) {
      toast(String(e), 'error');
    }
  };

  const clear = async () => {
    if (!(await confirm({ title: t('fin.clear'), message: t('fin.clearConfirm'), danger: true, confirmText: t('c.delete') }))) return;
    await ledger.clear();
    setSales([]);
  };

  return (
    <div className="page">
      <PageHeader
        title={t('fin.title')}
        actions={
          <>
            <button className="icon-btn" onClick={() => void exportCsv()} aria-label={t('fin.export')} disabled={!shown.length}>
              <Download size={20} />
            </button>
            <button className="icon-btn danger" onClick={() => void clear()} aria-label={t('fin.clear')} disabled={!sales.length}>
              <Trash2 size={20} />
            </button>
          </>
        }
      />
      <Segmented
        value={range}
        onChange={setRange}
        options={[
          { value: 'today', label: t('fin.range.today') },
          { value: 'week', label: t('fin.range.week') },
          { value: 'month', label: t('fin.range.month') },
          { value: 'all', label: t('fin.range.all') },
        ]}
      />
      <div className="stat wide accent">
        <span>{t('fin.total')}</span>
        <b>{formatMoney(total, settings.currency)}</b>
        <small>{t('fin.count', { n: shown.length })}</small>
      </div>
      <SearchBar value={q} onChange={setQ} />
      <ul className="cards">
        {shown.slice(0, 500).map((s) => (
          <li key={s.id} className="item">
            <div className="item-main">
              <div className="item-title">
                <strong dir="ltr">{s.user}</strong>
                <Badge tone={s.kind === 'voucher' ? 'info' : s.kind === 'renewal' ? 'warn' : 'ok'}>{t(`fin.kind.${s.kind}` as MessageKey)}</Badge>
              </div>
              <div className="item-sub">
                <span dir="ltr">{s.profile}</span>
                <span>{formatDateTime(new Date(s.at), locale)}</span>
                <span>{t('fin.by', { name: s.actor })}</span>
              </div>
            </div>
            <b className="amount">{formatMoney(s.price, settings.currency)}</b>
          </li>
        ))}
      </ul>
      {shown.length === 0 && <Empty text={q ? t('c.noMatch') : t('c.empty')} />}
      <Notice>{t('fin.deviceNote')}</Notice>
    </div>
  );
}
