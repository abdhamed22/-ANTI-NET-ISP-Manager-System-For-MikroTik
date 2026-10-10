import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mock, type Mock } from './helpers.ts';
import { RouterClient, RouterError, baseUrl, isValidHost } from '../src/core/routeros/client.ts';
import { NodeTransport } from './helpers.ts';
import {
  activateSubscription,
  currentSubscription,
  disconnectUser,
  monitorTraffic,
  planDistribution,
  renewSubscription,
  SubscriptionError,
  PATHS,
} from '../src/core/um.ts';
import {
  addStaff,
  changeOwnPassword,
  guardStaffChange,
  identify,
  listStaff,
  removeStaff,
  StaffError,
  GROUP_POLICIES,
} from '../src/core/staff.ts';

let m: Mock;
before(async () => {
  m = await mock();
});
after(async () => {
  await m.close();
});

test('wrong password is reported as an auth error', async () => {
  await assert.rejects(m.client('admin', 'wrong').list(PATHS.users), (e: unknown) => e instanceof RouterError && e.kind === 'auth');
});

test('RouterOS error detail is surfaced', async () => {
  await assert.rejects(m.client().add(PATHS.users, { name: 'ali', password: 'x' }), (e: unknown) => {
    return e instanceof RouterError && e.kind === 'bad-request' && /already exists/.test(e.detail);
  });
});

test('client rejects unsafe paths and bad hosts before sending anything', async () => {
  const c = m.client();
  await assert.rejects(c.list('user-manager/../user'), (e: unknown) => e instanceof RouterError && e.detail.startsWith('invalid-path'));
  assert.throws(() => new RouterClient(new NodeTransport(), { host: 'bad host', port: 80, secure: false }, { username: 'a', password: 'b' }));
  assert.equal(isValidHost('192.168.88.1'), true);
  assert.equal(isValidHost('router.lan'), true);
  assert.equal(isValidHost('999.1.1.1'), false);
  assert.equal(baseUrl({ host: 'fe80::1', port: 443, secure: true }), 'https://[fe80::1]:443/rest');
});

test('only GET and POST reach the router', async () => {
  const methods = new Set(m.state.requests.map((r) => r.method));
  for (const method of methods) assert.ok(method === 'GET' || method === 'POST', method);
});

test('roles come from the RouterOS group policies', async () => {
  assert.equal((await identify(m.client())).role, 'admin');
  assert.equal((await identify(m.client('support1', 'support123'))).role, 'support');
  // A group without the rest-api policy cannot log in at all.
  await assert.rejects(identify(m.client('noapi', 'noapi123')), (e: unknown) => e instanceof RouterError && e.kind === 'auth');
});

test('adding a viewer creates a least-privilege group', async () => {
  await addStaff(m.client(), { name: 'acct', password: 'Viewer-pass-1', role: 'viewer', allowedAddress: '192.168.88.0/24', comment: '' });
  const group = m.state.menus['user/group'].find((g) => g.name === 'antinet-viewer');
  assert.equal(group?.policy, GROUP_POLICIES.viewer);
  const who = await identify(m.client('acct', 'Viewer-pass-1'));
  assert.equal(who.role, 'viewer');
  // Viewers cannot change data even by calling the API directly.
  await assert.rejects(m.client('acct', 'Viewer-pass-1').add(PATHS.users, { name: 'x', password: 'y' }), (e: unknown) => e instanceof RouterError && e.kind === 'forbidden');
});

test('support staff cannot create router accounts', async () => {
  await assert.rejects(
    addStaff(m.client('support1', 'support123'), { name: 'evil', password: 'Evil-pass-1', role: 'admin', allowedAddress: '', comment: '' }),
    (e: unknown) => e instanceof RouterError,
  );
});

test('cannot remove yourself or the last admin', async () => {
  const staff = await listStaff(m.client());
  const admin = staff.find((s) => s.name === 'admin')!;
  assert.throws(() => guardStaffChange(staff, admin, 'admin'), (e: unknown) => e instanceof StaffError && e.code === 'self');
  assert.throws(() => guardStaffChange(staff, admin, 'support1'), (e: unknown) => e instanceof StaffError && e.code === 'last-admin');
  const acct = staff.find((s) => s.name === 'acct')!;
  await removeStaff(m.client(), 'admin', acct);
  assert.equal((await listStaff(m.client())).some((s) => s.name === 'acct'), false);
});

test('staff can change their own password', async () => {
  await changeOwnPassword(m.client('support1', 'support123'), 'support123', 'Support-new-1');
  assert.equal((await identify(m.client('support1', 'Support-new-1'))).role, 'support');
  await changeOwnPassword(m.client('support1', 'Support-new-1'), 'Support-new-1', 'support123');
});

test('activation is refused while a subscription is running', async () => {
  await assert.rejects(activateSubscription(m.client(), 'ali', '20M-Month'), (e: unknown) => e instanceof SubscriptionError && e.code === 'already-active');
  await assert.rejects(activateSubscription(m.client(), 'ghost', '20M-Month'), (e: unknown) => e instanceof SubscriptionError && e.code === 'unknown-user');
  await activateSubscription(m.client(), 'omar', '10M-Month');
  const ups = m.state.menus['user-manager/user-profile'].filter((u) => u.user === 'omar');
  assert.equal(ups.length, 1);
  assert.equal(ups[0].state, 'running-active');
});

test('renew "replace" adds the new subscription before removing the old one', async () => {
  const start = m.state.requests.length;
  await renewSubscription(m.client(), 'omar', '20M-Month', 'replace');
  const ops = m.state.requests.slice(start).filter((r) => r.method === 'POST').map((r) => r.path);
  assert.deepEqual(ops, ['/rest/user-manager/user-profile/add', '/rest/user-manager/user-profile/remove']);
  const ups = m.state.menus['user-manager/user-profile'].filter((u) => u.user === 'omar');
  assert.deepEqual(ups.map((u) => u.profile), ['20M-Month']);
});

test('renew "queue" keeps the running subscription', async () => {
  await renewSubscription(m.client(), 'ali', '20M-Month', 'queue');
  const ups = m.state.menus['user-manager/user-profile'].filter((u) => u.user === 'ali');
  assert.deepEqual(ups.map((u) => u.state).sort(), ['running-active', 'waiting']);
  assert.equal(currentSubscription(ups)?.state, 'running-active');
});

test('disconnect closes the live PPP connection, not the accounting record', async () => {
  const sessionsBefore = m.state.menus['user-manager/session'].length;
  assert.equal(await disconnectUser(m.client(), 'ali'), 1);
  assert.equal(m.state.menus['ppp/active'].length, 0);
  assert.equal(m.state.menus['user-manager/session'].length, sessionsBefore);
  assert.equal(await disconnectUser(m.client(), 'nobody'), 0);
});

test('traffic monitor and plan distribution', async () => {
  const t = await monitorTraffic(m.client(), 'ether1');
  assert.equal(t.rx, 12500000);
  assert.equal(t.tx, 3400000);
  const dist = planDistribution(m.state.menus['user-manager/user-profile']);
  assert.ok(dist.every((d) => d.value > 0));
  assert.equal(dist.reduce((s, d) => s + d.value, 0), m.state.menus['user-manager/user-profile'].filter((u) => u.state !== 'used').length);
});

test('live sessions are filtered on the router, with a fallback', async () => {
  const { listActiveSessions, resetSessionFilterProbe } = await import('../src/core/um.ts');
  resetSessionFilterProbe();
  const start = m.state.requests.length;
  const live = await listActiveSessions(m.client());
  assert.deepEqual(live.map((s) => s.user), ['ali']);
  // One filtered request; the full history was not downloaded.
  assert.equal(m.state.requests.length - start, 1);
  assert.ok(m.state.requests[start].path === '/rest/user-manager/session');
  // Once the filter is known to work, an empty answer is trusted (no second request).
  for (const s of m.state.menus['user-manager/session']) s.active = 'false';
  const before = m.state.requests.length;
  assert.deepEqual(await listActiveSessions(m.client()), []);
  assert.equal(m.state.requests.length - before, 1);
  // Undecided + empty: verified against the full list.
  resetSessionFilterProbe();
  const b2 = m.state.requests.length;
  assert.deepEqual(await listActiveSessions(m.client()), []);
  assert.equal(m.state.requests.length - b2, 2);
  m.state.menus['user-manager/session'][0].active = 'true';
});
