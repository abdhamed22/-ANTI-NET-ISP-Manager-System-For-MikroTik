// Mock RouterOS v7 REST API for development and tests. It emulates the menus the
// app uses, Basic auth, group policies, and RouterOS error responses. It is NOT
// a full RouterOS implementation; behaviour was modelled on the MikroTik REST
// documentation and the original app's usage.
//
//   node mock/server.mjs            # listens on 127.0.0.1:8729
//   PORT=9000 node mock/server.mjs

import http from 'node:http';

export function createState() {
  let nextId = 1;
  const id = () => `*${(nextId++).toString(16).toUpperCase()}`;
  const rec = (o) => ({ '.id': id(), ...Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)])) });
  const menus = {
    'user/group': [
      rec({ name: 'read', policy: 'local,telnet,ssh,reboot,read,test,winbox,password,web,sniff,sensitive,api,romon,rest-api,!ftp,!write,!policy', skin: 'default' }),
      rec({ name: 'write', policy: 'local,telnet,ssh,reboot,read,write,test,winbox,password,web,sniff,sensitive,api,romon,rest-api,!ftp,!policy', skin: 'default' }),
      rec({ name: 'full', policy: 'local,telnet,ssh,ftp,reboot,read,write,policy,test,winbox,password,web,sniff,sensitive,api,romon,rest-api', skin: 'default' }),
      rec({ name: 'antinet-support', policy: 'read,write,test,password,api,rest-api', comment: 'ANTI-NET ISP Manager' }),
      rec({ name: 'winbox-only', policy: 'read,winbox,!api,!rest-api' }),
    ],
    user: [
      rec({ name: 'admin', group: 'full', address: '', disabled: 'false', 'last-logged-in': '2026-10-01 10:00:00', comment: 'system default user' }),
      rec({ name: 'support1', group: 'antinet-support', address: '', disabled: 'false', 'last-logged-in': '', comment: '' }),
      rec({ name: 'noapi', group: 'winbox-only', address: '', disabled: 'false', comment: '' }),
    ],
    'user-manager/router': [rec({ name: 'Main-Tower', address: '192.168.88.1', 'shared-secret': 'testing123', 'coa-port': '3799', disabled: 'false' })],
    'user-manager/profile': [
      rec({ name: '10M-Month', 'name-for-users': '10M', validity: '30d', price: '25000', 'starts-when': 'assigned', 'override-shared-users': 'off' }),
      rec({ name: '20M-Month', 'name-for-users': '20M', validity: '30d', price: '35000', 'starts-when': 'assigned', 'override-shared-users': 'off' }),
    ],
    'user-manager/limitation': [
      rec({ name: '10M', 'rate-limit-rx': '5M', 'rate-limit-tx': '10M', 'download-limit': '0', 'upload-limit': '0', 'transfer-limit': '0', 'uptime-limit': '0s' }),
    ],
    'user-manager/profile-limitation': [],
    'user-manager/user': [
      rec({ name: 'ali', password: 'pass-ali', group: 'default', 'shared-users': '1', attributes: '', disabled: 'false' }),
      rec({ name: 'sara', password: 'pass-sara', group: 'default', 'shared-users': '1', attributes: 'Framed-Pool:pool1', disabled: 'false' }),
      rec({ name: 'omar', password: 'pass-omar', group: 'default', 'shared-users': 'unlimited', attributes: '', disabled: 'false' }),
    ],
    'user-manager/user-profile': [],
    'user-manager/session': [],
    'ppp/active': [],
    'ip/hotspot/active': [],
    interface: [
      rec({ name: 'ether1', type: 'ether', running: 'true', disabled: 'false' }),
      rec({ name: 'bridge', type: 'bridge', running: 'true', disabled: 'false' }),
      rec({ name: 'wlan1', type: 'wlan', running: 'false', disabled: 'true' }),
    ],
  };
  menus['user-manager/profile-limitation'].push(rec({ profile: '10M-Month', limitation: '10M', 'from-time': '0s', 'till-time': '23h59m59s', weekdays: 'sunday,monday,tuesday,wednesday,thursday,friday,saturday' }));
  menus['user-manager/user-profile'].push(rec({ user: 'ali', profile: '10M-Month', state: 'running-active', 'end-time': '2026-11-01 10:00:00' }));
  menus['user-manager/user-profile'].push(rec({ user: 'sara', profile: '20M-Month', state: 'used', 'end-time': '2026-09-01 10:00:00' }));
  menus['user-manager/session'].push(
    rec({ user: 'ali', 'user-address': '10.0.0.10', 'calling-station-id': 'AA:BB:CC:00:00:01', started: '2026-10-10 08:00:00', ended: '', 'terminate-cause': '', uptime: '1h2m', download: '104857600', upload: '10485760', active: 'true' }),
    rec({ user: 'sara', 'user-address': '10.0.0.11', 'calling-station-id': 'AA:BB:CC:00:00:02', started: '2026-09-01 08:00:00', ended: '2026-09-01 09:00:00', 'terminate-cause': 'user-request', uptime: '1h', download: '5242880', upload: '1048576', active: 'false' }),
  );
  menus['ppp/active'].push(rec({ name: 'ali', service: 'pppoe', address: '10.0.0.10', uptime: '1h2m' }));
  const passwords = new Map([
    ['admin', 'admin123'],
    ['support1', 'support123'],
    ['noapi', 'noapi123'],
  ]);
  return { menus, passwords, rec, id, requests: [] };
}

const UNIQUE_BY_NAME = new Set([
  'user',
  'user/group',
  'user-manager/router',
  'user-manager/profile',
  'user-manager/limitation',
  'user-manager/user',
]);

const ENTITY = {
  user: 'user',
  'user/group': 'group',
  'user-manager/router': 'router',
  'user-manager/profile': 'profile',
  'user-manager/limitation': 'limitation',
  'user-manager/user': 'user',
};

function send(res, status, body) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(text);
}

const err = (res, status, message, detail) => send(res, status, detail ? { error: status, message, detail } : { error: status, message });

function policiesOf(state, username) {
  const u = state.menus.user.find((x) => x.name === username);
  const g = u && state.menus['user/group'].find((x) => x.name === u.group);
  return new Set((g?.policy ?? '').split(',').filter((p) => p && !p.startsWith('!')));
}

function validityEnd(validity) {
  const m = /^(\d+)d$/.exec(validity ?? '');
  const days = m ? Number(m[1]) : 30;
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().replace('T', ' ').slice(0, 19);
}

export function handle(state, req, res, raw) {
  const url = new URL(req.url, 'http://x');
  state.requests.push({ method: req.method, path: url.pathname, body: raw });
  if (!url.pathname.startsWith('/rest/')) return err(res, 404, 'Not Found');

  const auth = req.headers.authorization ?? '';
  const m = /^Basic (.+)$/.exec(auth);
  const [user, ...rest] = m ? Buffer.from(m[1], 'base64').toString('utf8').split(':') : [];
  const pass = rest.join(':');
  const account = state.menus.user.find((u) => u.name === user && u.disabled !== 'true');
  if (!account || state.passwords.get(user) !== pass) return err(res, 401, 'Unauthorized');
  const pol = policiesOf(state, user);
  if (!pol.has('api') || !pol.has('rest-api')) return err(res, 401, 'Unauthorized');

  let path = url.pathname.slice('/rest/'.length).replace(/\/$/, '');
  let body = {};
  if (raw) {
    try {
      body = JSON.parse(raw);
    } catch {
      return err(res, 400, 'Bad Request', 'invalid JSON');
    }
  }

  if (req.method === 'GET') {
    if (!pol.has('read')) return err(res, 403, 'Forbidden');
    if (path === 'system/resource') {
      return send(res, 200, {
        uptime: '3d4h5m', version: '7.16.2 (stable)', 'board-name': 'CHR', 'cpu-load': '7',
        'free-memory': '805306368', 'total-memory': '1073741824', 'architecture-name': 'x86_64',
      });
    }
    const list = state.menus[path];
    if (!list) return err(res, 404, 'Not Found', 'no such command or directory');
    let rows = list;
    for (const [k, v] of url.searchParams) {
      if (k === '.proplist') continue;
      rows = rows.filter((r) => (r[k] ?? '') === v);
    }
    const prop = url.searchParams.get('.proplist');
    if (prop) {
      const keys = prop.split(',');
      rows = rows.map((r) => Object.fromEntries(keys.filter((k) => k in r).map((k) => [k, r[k]])));
    }
    return send(res, 200, rows);
  }

  if (req.method !== 'POST') return err(res, 400, 'Bad Request', 'only GET and POST are emulated');

  if (path === 'password') {
    if (!pol.has('password')) return err(res, 403, 'Forbidden');
    if (state.passwords.get(user) !== body['old-password']) return err(res, 400, 'Bad Request', 'old password is not correct');
    if (body['new-password'] !== body['confirm-new-password']) return err(res, 400, 'Bad Request', 'passwords do not match');
    state.passwords.set(user, body['new-password']);
    return send(res, 200, []);
  }
  if (path === 'interface/monitor-traffic') {
    if (!state.menus.interface.some((i) => i.name === body.interface)) return err(res, 400, 'Bad Request', 'no such item');
    if (!('once' in body) && !('duration' in body)) return err(res, 400, 'Bad Request', 'missing once');
    return send(res, 200, [{ name: body.interface, 'rx-bits-per-second': '12500000', 'tx-bits-per-second': '3400000' }]);
  }

  const cmd = path.slice(path.lastIndexOf('/') + 1);
  const menuPath = path.slice(0, path.lastIndexOf('/'));
  const list = state.menus[menuPath];
  if (!list) return err(res, 404, 'Not Found', 'no such command or directory');
  const write = cmd === 'add' || cmd === 'set' || cmd === 'remove';
  if (write && !pol.has('write')) return err(res, 403, 'Forbidden');
  if (write && (menuPath === 'user' || menuPath === 'user/group') && !pol.has('policy')) {
    return err(res, 400, 'Bad Request', 'not enough permissions (9)');
  }

  if (cmd === 'print') return send(res, 200, list);

  if (cmd === 'add') {
    if (UNIQUE_BY_NAME.has(menuPath)) {
      if (!body.name) return err(res, 400, 'Bad Request', 'missing value(s) of argument(s) name');
      if (list.some((r) => r.name === body.name)) {
        return err(res, 400, 'Bad Request', `failure: ${ENTITY[menuPath]} with the same name already exists`);
      }
    }
    if (menuPath === 'user-manager/user-profile') {
      if (!state.menus['user-manager/user'].some((u) => u.name === body.user)) return err(res, 400, 'Bad Request', 'input does not match any value of user');
      const prof = state.menus['user-manager/profile'].find((p) => p.name === body.profile);
      if (!prof) return err(res, 400, 'Bad Request', 'input does not match any value of profile');
      const running = list.some((up) => up.user === body.user && ['running', 'running-active', 'waiting'].includes(up.state));
      const r = state.rec({ user: body.user, profile: body.profile, state: running ? 'waiting' : 'running-active', 'end-time': running ? 'not-yet-running' : validityEnd(prof.validity) });
      list.push(r);
      return send(res, 200, { ret: r['.id'] });
    }
    if (menuPath === 'user-manager/profile-limitation') {
      if (!state.menus['user-manager/profile'].some((p) => p.name === body.profile)) return err(res, 400, 'Bad Request', 'input does not match any value of profile');
      if (!state.menus['user-manager/limitation'].some((p) => p.name === body.limitation)) return err(res, 400, 'Bad Request', 'input does not match any value of limitation');
    }
    if (menuPath === 'user') {
      if (!state.menus['user/group'].some((g) => g.name === body.group)) return err(res, 400, 'Bad Request', 'input does not match any value of group');
      state.passwords.set(body.name, body.password ?? '');
      const { password: _p, ...restBody } = body;
      const r = state.rec({ address: '', disabled: 'false', comment: '', ...restBody });
      list.push(r);
      return send(res, 200, { ret: r['.id'] });
    }
    const r = state.rec(body);
    list.push(r);
    return send(res, 200, { ret: r['.id'] });
  }

  if (cmd === 'set') {
    const r = list.find((x) => x['.id'] === body['.id']);
    if (!r) return err(res, 400, 'Bad Request', 'no such item');
    if (body.name && UNIQUE_BY_NAME.has(menuPath) && list.some((x) => x !== r && x.name === body.name)) {
      return err(res, 400, 'Bad Request', `failure: ${ENTITY[menuPath]} with the same name already exists`);
    }
    for (const [k, v] of Object.entries(body)) {
      if (k === '.id') continue;
      if (menuPath === 'user' && k === 'password') state.passwords.set(r.name, String(v));
      else r[k] = String(v);
    }
    return send(res, 200, []);
  }

  if (cmd === 'remove') {
    const ids = String(body['.id'] ?? '').split(',').filter(Boolean);
    if (ids.length === 0) return err(res, 400, 'Bad Request', 'missing .id');
    for (const i of ids) if (!list.some((x) => x['.id'] === i)) return err(res, 400, 'Bad Request', 'no such item');
    state.menus[menuPath] = list.filter((x) => !ids.includes(x['.id']));
    return send(res, 200, []);
  }

  return err(res, 400, 'Bad Request', 'no such command');
}

export function startMock(port = 0, state = createState()) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        handle(state, req, res, raw);
      } catch (e) {
        err(res, 500, 'Internal Server Error', String(e));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve({ server, state, port: server.address().port }));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT ?? 8729);
  startMock(port).then(({ port: p }) => {
    console.log(`Mock RouterOS REST listening on http://127.0.0.1:${p}/rest  (admin/admin123, support1/support123)`);
  });
}
