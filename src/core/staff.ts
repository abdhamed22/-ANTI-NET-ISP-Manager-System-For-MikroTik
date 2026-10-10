import { RouterError, isTrue, type RouterClient } from './routeros/client.ts';
import { idOf } from './um.ts';

// Staff are real RouterOS accounts. The router checks every password and
// permission itself; the app only maps the account's group to a role so it can
// hide pages a person is not meant to use.

export type Role = 'admin' | 'support' | 'viewer';

export const SUPPORT_GROUP = 'antinet-support';
export const VIEWER_GROUP = 'antinet-viewer';
export const ADMIN_GROUP = 'full';

/**
 * Policies for the groups the app creates. REST access needs "api" + "rest-api";
 * "password" only lets a person change their own password. No
 * winbox/ssh/web/ftp/telnet/policy/sensitive/reboot, so support staff cannot open
 * Winbox or WebFig, manage accounts, or read stored secrets.
 */
export const GROUP_POLICIES: Record<Exclude<Role, 'admin'>, string> = {
  support: 'read,write,test,password,api,rest-api',
  viewer: 'read,password,api,rest-api',
};

export function parsePolicies(policy: string | undefined): Set<string> {
  return new Set(
    (policy ?? '')
      .split(',')
      .map((p) => p.trim())
      .filter((p) => p && !p.startsWith('!')),
  );
}

export function roleFromPolicies(granted: Set<string>): Role {
  if (granted.has('write') && granted.has('policy')) return 'admin';
  if (granted.has('write')) return 'support';
  return 'viewer';
}

export interface Identity {
  username: string;
  group: string;
  role: Role;
  policies: string[];
}

/**
 * Confirms the credentials and works out the role. A wrong password comes back
 * from RouterOS as HTTP 401 and is rethrown as RouterError('auth').
 */
export async function identify(client: RouterClient): Promise<Identity> {
  const me = (await client.list('user', { name: client.username })).find((u) => u.name === client.username);
  if (!me) {
    // Remote (RADIUS) logins have no local /user entry; treat them as read-only.
    return { username: client.username, group: '', role: 'viewer', policies: [] };
  }
  const group = me.group ?? '';
  const groups = await client.list('user/group', { name: group });
  const g = groups.find((x) => x.name === group);
  const granted = parsePolicies(g?.policy);
  return { username: client.username, group, role: roleFromPolicies(granted), policies: [...granted] };
}

export interface StaffMember {
  id: string;
  name: string;
  group: string;
  role: Role;
  allowedAddress: string;
  disabled: boolean;
  lastLoggedIn: string;
  comment: string;
}

export async function listStaff(client: RouterClient): Promise<StaffMember[]> {
  const [users, groups] = await Promise.all([client.list('user'), client.list('user/group')]);
  const roleOf = new Map(groups.map((g) => [g.name, roleFromPolicies(parsePolicies(g.policy))]));
  return users.map((u) => ({
    id: idOf(u),
    name: u.name ?? '',
    group: u.group ?? '',
    role: roleOf.get(u.group ?? '') ?? 'viewer',
    allowedAddress: u.address ?? '',
    disabled: isTrue(u.disabled),
    lastLoggedIn: u['last-logged-in'] ?? '',
    comment: u.comment ?? '',
  }));
}

export function groupForRole(role: Role): string {
  return role === 'admin' ? ADMIN_GROUP : role === 'support' ? SUPPORT_GROUP : VIEWER_GROUP;
}

/** Creates the support/viewer group with least-privilege policies if it is missing. */
export async function ensureGroup(client: RouterClient, role: Role): Promise<string> {
  const name = groupForRole(role);
  if (role === 'admin') return name;
  const existing = (await client.list('user/group', { name })).find((g) => g.name === name);
  const policy = GROUP_POLICIES[role];
  if (!existing) {
    await client.add('user/group', { name, policy, comment: 'ANTI-NET ISP Manager' });
  } else if ((existing.policy ?? '') !== policy) {
    // Keep the group least-privilege even if someone widened it by hand.
    const granted = parsePolicies(existing.policy);
    const wanted = new Set(policy.split(','));
    const same = granted.size === wanted.size && [...wanted].every((p) => granted.has(p));
    if (!same) await client.set('user/group', idOf(existing), { policy });
  }
  return name;
}

export interface NewStaff {
  name: string;
  password: string;
  role: Role;
  allowedAddress: string;
  comment: string;
}

export async function addStaff(client: RouterClient, s: NewStaff): Promise<void> {
  const group = await ensureGroup(client, s.role);
  const data: Record<string, string> = { name: s.name.trim(), password: s.password, group };
  if (s.allowedAddress.trim()) data.address = s.allowedAddress.trim();
  if (s.comment.trim()) data.comment = s.comment.trim();
  await client.add('user', data);
}

export class StaffError extends Error {
  readonly code: 'self' | 'last-admin';
  constructor(code: StaffError['code']) {
    super(code);
    this.name = 'StaffError';
    this.code = code;
  }
}

/** Blocks removing/disabling yourself or the last enabled admin. */
export function guardStaffChange(all: StaffMember[], target: StaffMember, me: string): void {
  if (target.name === me) throw new StaffError('self');
  if (target.role === 'admin') {
    const admins = all.filter((m) => m.role === 'admin' && !m.disabled);
    if (admins.length <= 1) throw new StaffError('last-admin');
  }
}

export async function removeStaff(client: RouterClient, me: string, target: StaffMember): Promise<void> {
  guardStaffChange(await listStaff(client), target, me);
  await client.remove('user', target.id);
}

export async function setStaffDisabled(client: RouterClient, me: string, target: StaffMember, disabled: boolean): Promise<void> {
  if (disabled) guardStaffChange(await listStaff(client), target, me);
  await client.set('user', target.id, { disabled: disabled ? 'yes' : 'no' });
}

export async function setStaffPassword(client: RouterClient, target: StaffMember, password: string): Promise<void> {
  await client.set('user', target.id, { password });
}

/** Changes the signed-in account's own password (RouterOS /password). */
export async function changeOwnPassword(client: RouterClient, oldPassword: string, newPassword: string): Promise<void> {
  await client.command('password', {
    'old-password': oldPassword,
    'new-password': newPassword,
    'confirm-new-password': newPassword,
  });
}

export function isAuthError(e: unknown): boolean {
  return e instanceof RouterError && e.kind === 'auth';
}

export function can(role: Role, action: 'configure' | 'operate' | 'finance' | 'staff'): boolean {
  switch (action) {
    case 'configure':
    case 'finance':
    case 'staff':
      return role === 'admin';
    case 'operate':
      return role === 'admin' || role === 'support';
  }
}

