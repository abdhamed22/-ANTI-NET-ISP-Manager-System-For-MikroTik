import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mock, type Mock } from './helpers.ts';
import { MemoryStore } from '../src/core/store.ts';
import { Ledger, lastSevenDays, localDay, salesToCsv, totalForDay, type Sale } from '../src/core/ledger.ts';
import { VOUCHER_ALPHABET, VoucherStore, generateBatch, provisionVouchers, secureRandomString } from '../src/core/vouchers.ts';
import { exportBackup, parseBackup, restoreBackup, wipeUserManager, BackupFormatError } from '../src/core/backup.ts';
import {
  formatAttributes,
  parseAttributes,
  vAddressList,
  vAttributes,
  vDuration,
  vName,
  vRate,
  vTime,
} from '../src/core/validate.ts';
import { formatMoney } from '../src/core/settings.ts';

let m: Mock;
before(async () => {
  m = await mock();
});
after(async () => {
  await m.close();
});

test('secure random strings use only the voucher alphabet', () => {
  const s = secureRandomString(5000);
  assert.equal(s.length, 5000);
  for (const ch of s) assert.ok(VOUCHER_ALPHABET.includes(ch), ch);
  // Every symbol should show up in 5000 draws from 57 symbols.
  assert.equal(new Set(s).size, VOUCHER_ALPHABET.length);
});

test('voucher batches are unique and respect limits', () => {
  const taken = new Set(['NET-aaaaaa']);
  const batch = generateBatch({ quantity: 200, profile: '10M-Month', prefix: 'NET-', length: 6, attributes: '' }, taken);
  assert.equal(batch.length, 200);
  assert.equal(new Set(batch.map((v) => v.username)).size, 200);
  assert.ok(batch.every((v) => v.username.startsWith('NET-') && v.password.length === 6 && v.status === 'stock'));
  assert.throws(() => generateBatch({ quantity: 0, profile: 'p', prefix: '', length: 6, attributes: '' }, new Set()));
  assert.throws(() => generateBatch({ quantity: 10, profile: 'p', prefix: '', length: 3, attributes: '' }, new Set()));
});

test('provisioning creates user + subscription and logs the sale', async () => {
  const store = new VoucherStore(new MemoryStore());
  const ledger = new Ledger(new MemoryStore());
  const batch = generateBatch({ quantity: 3, profile: '10M-Month', prefix: 'V-', length: 8, attributes: 'Framed-Pool:pool2' }, new Set());
  await store.add(batch);
  const res = await provisionVouchers(m.client(), store, ledger, batch.map((v) => v.id), 'admin');
  assert.equal(res.ok, 3);
  assert.equal(res.failed.length, 0);
  for (const v of batch) {
    const u = m.state.menus['user-manager/user'].find((x) => x.name === v.username);
    assert.equal(u?.attributes, 'Framed-Pool:pool2');
    assert.ok(m.state.menus['user-manager/user-profile'].some((x) => x.user === v.username && x.profile === '10M-Month'));
  }
  const sales = await ledger.all();
  assert.equal(sales.length, 3);
  assert.ok(sales.every((s) => s.price === 25000 && s.kind === 'voucher' && s.actor === 'admin'));
  assert.ok((await store.all()).every((v) => v.status === 'provisioned'));
});

test('a failed subscription rolls back the new user', async () => {
  const store = new VoucherStore(new MemoryStore());
  const ledger = new Ledger(new MemoryStore());
  const [v] = generateBatch({ quantity: 1, profile: 'no-such-profile', prefix: 'X-', length: 8, attributes: '' }, new Set());
  await store.add([v]);
  const res = await provisionVouchers(m.client(), store, ledger, [v.id], 'admin');
  assert.equal(res.ok, 0);
  assert.equal(res.failed.length, 1);
  assert.equal(m.state.menus['user-manager/user'].some((u) => u.name === v.username), false);
  assert.equal((await store.all())[0].status, 'failed');
  assert.equal((await ledger.all()).length, 0);
});

test('ledger totals use local days and serialize writes', async () => {
  const ledger = new Ledger(new MemoryStore());
  const now = new Date(2026, 9, 10, 12, 0, 0);
  await Promise.all([
    ledger.record({ user: 'a', profile: 'p', price: 1000, actor: 'x', kind: 'activation', at: now.toISOString() }),
    ledger.record({ user: 'b', profile: 'p', price: 2000, actor: 'x', kind: 'activation', at: now.toISOString() }),
    ledger.record({ user: 'c', profile: 'p', price: 500, actor: 'x', kind: 'renewal', at: new Date(2026, 9, 8, 9).toISOString() }),
  ]);
  const all = await ledger.all();
  assert.equal(all.length, 3);
  assert.equal(totalForDay(all, localDay(now)), 3000);
  const week = lastSevenDays(all, now);
  assert.equal(week.length, 7);
  assert.equal(week[6].total, 3000);
  assert.equal(week[4].total, 500);
});

test('CSV export neutralizes spreadsheet formulas', () => {
  const sales: Sale[] = [{ id: '1', at: '2026-10-10T10:00:00.000Z', user: '=HYPERLINK("x")', profile: 'p,1', price: 5, actor: '@me', kind: 'voucher' }];
  const csv = salesToCsv(sales, 'IQD');
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"p,1"'));
  assert.ok(csv.includes("'@me"));
});

test('backup → wipe → restore brings User Manager data back', async () => {
  const c = m.client();
  const before = JSON.parse(JSON.stringify(m.state.menus));
  const file = await exportBackup(c, [], [], 'admin');
  const text = JSON.stringify(file);
  await wipeUserManager(c, true);
  assert.equal(m.state.menus['user-manager/user'].length, 0);
  assert.equal(m.state.menus['user-manager/router'].length, 0);

  const report = await restoreBackup(c, parseBackup(text), { overwrite: false, subscriptions: true });
  assert.equal(report.failed.length, 0, JSON.stringify(report.failed));
  const names = (k: string, s: Record<string, Array<Record<string, string>>>) => s[k].map((r) => r.name).sort();
  for (const k of ['user-manager/user', 'user-manager/profile', 'user-manager/limitation', 'user-manager/router']) {
    assert.deepEqual(names(k, m.state.menus), names(k, before), k);
  }
  assert.equal(m.state.menus['user-manager/profile-limitation'].length, before['user-manager/profile-limitation'].length);
  // Only running/queued subscriptions are re-created, one per user.
  const restoredUsers = m.state.menus['user-manager/user-profile'].map((u) => u.user);
  assert.equal(new Set(restoredUsers).size, restoredUsers.length);

  // Restoring again changes nothing.
  const again = await restoreBackup(c, parseBackup(text), { overwrite: false, subscriptions: true });
  assert.equal(again.created, 0);
});

test('legacy Windows backups are converted', () => {
  const legacy = {
    users: [{ id: '*1', name: 'old', password: 'pw', 'shared-users': '1', uptime: '5h' }],
    profiles: [{ id: '*2', name: 'P', validity: '30d', price: '10' }],
    routers: [],
    limitations: [],
    profile_limitations: [],
    user_profiles: [{ id: '*3', user: 'old', profile: 'P', state: 'running-active' }],
    transactions: [{ id: 'ab12cd34', user: 'old', profile: 'P', price: 10, date: '2026-04-20T10:00:00', admin: 'Admin' }],
    vouchers: [{ id: 'x', username: 'NET-abc', password: 'zzz', profile: 'P', attributes: '', status: 'In Stock' }],
  };
  const f = parseBackup(JSON.stringify(legacy));
  assert.equal(f.router.users[0].name, 'old');
  assert.equal(f.local.sales[0].price, 10);
  assert.equal(f.local.sales[0].actor, 'Admin');
  assert.equal(f.local.vouchers[0].status, 'stock');
  assert.throws(() => parseBackup('{"hello":1}'), BackupFormatError);
  assert.throws(() => parseBackup('not json'), BackupFormatError);
});

test('validators', () => {
  assert.equal(vName('ali'), null);
  assert.equal(vName('a b'), 'v.nameChars');
  assert.equal(vName(''), 'v.required');
  assert.equal(vRate('10M'), null);
  assert.equal(vRate('1.5M'), null);
  assert.equal(vRate('10 Mbps'), 'v.rate');
  assert.equal(vDuration('30d'), null);
  assert.equal(vDuration('1w2d'), null);
  assert.equal(vDuration('unlimited'), null);
  assert.equal(vDuration('30 days'), 'v.duration');
  assert.equal(vTime('23:59:59'), null);
  assert.equal(vTime('25:00:00'), 'v.time');
  assert.equal(vAddressList('192.168.88.0/24, 10.0.0.5'), null);
  assert.equal(vAddressList('192.168.88.0/33'), 'v.ip');
  const attrs = parseAttributes('Framed-Pool:pool1,Mikrotik-Rate-Limit:5M/10M');
  assert.equal(attrs.length, 2);
  assert.equal(formatAttributes(attrs), 'Framed-Pool:pool1,Mikrotik-Rate-Limit:5M/10M');
  assert.equal(vAttributes(attrs), null);
  assert.equal(vAttributes([{ key: 'Framed-Pool', value: 'a,b' }]), 'v.attributeValue');
  assert.equal(vAttributes([{ key: 'Evil', value: 'x' }]), 'v.attribute');
  assert.equal(formatMoney(25000, 'IQD'), '25,000 IQD');
  assert.equal(formatMoney(15, 'USD'), '$15.00');
});
