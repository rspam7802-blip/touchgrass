import { type AdminSection, canAccessSection, resources } from '@touchgrass/shared';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, rolesFromToken } from './admin-session';

const t = resources.en.admin;
const c = t.console;

/** Every dashboard section, in menu order, with the shared role matrix deciding who sees it (F-WEB-03). */
export type AdminNavGroup = 'overview' | 'people' | 'plans' | 'content' | 'growth' | 'system';
export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  'overview',
  'people',
  'plans',
  'content',
  'growth',
  'system',
];

export const ADMIN_NAV: {
  group: AdminNavGroup;
  section: AdminSection;
  href: string;
  label: string;
}[] = [
  { group: 'overview', section: 'dashboard', href: '/admin', label: t.dashboard },
  { group: 'overview', section: 'analytics', href: '/admin/analytics', label: c.analytics },
  { group: 'people', section: 'users', href: '/admin/users', label: t.users },
  {
    group: 'people',
    section: 'verifications',
    href: '/admin/verifications',
    label: t.verifications,
  },
  { group: 'people', section: 'moderation', href: '/admin/moderation', label: t.moderation },
  { group: 'plans', section: 'events', href: '/admin/events', label: c.events },
  { group: 'plans', section: 'cities', href: '/admin/cities', label: c.cities },
  { group: 'plans', section: 'venues', href: '/admin/venues', label: t.venuesPerks },
  {
    group: 'people',
    section: 'hostApplications',
    href: '/admin/host-applications',
    label: t.hostApplications,
  },
  { group: 'content', section: 'icebreakers', href: '/admin/icebreakers', label: t.icebreakers },
  { group: 'content', section: 'taxonomy', href: '/admin/taxonomy', label: c.taxonomy },
  { group: 'content', section: 'badges', href: '/admin/badges', label: t.badges },
  { group: 'content', section: 'challenges', href: '/admin/challenges', label: t.challenges },
  { group: 'content', section: 'feedback', href: '/admin/feedback', label: t.feedback },
  { group: 'plans', section: 'payments', href: '/admin/payments', label: t.payments },
  { group: 'growth', section: 'inviteCodes', href: '/admin/invite-codes', label: t.inviteCodes },
  { group: 'growth', section: 'waitlist', href: '/admin/waitlist', label: t.waitlist.title },
  { group: 'growth', section: 'network', href: '/admin/network', label: t.network.title },
  { group: 'growth', section: 'weights', href: '/admin/weights', label: c.weights },
  {
    group: 'content',
    section: 'notificationTemplates',
    href: '/admin/notification-templates',
    label: c.templates,
  },
  { group: 'system', section: 'featureFlags', href: '/admin/feature-flags', label: t.featureFlags },
  { group: 'system', section: 'settings', href: '/admin/settings', label: t.settings },
  { group: 'people', section: 'team', href: '/admin/team', label: c.team },
  { group: 'system', section: 'auditLog', href: '/admin/audit-log', label: t.auditLog },
];

export async function currentRoles(): Promise<string[]> {
  return rolesFromToken((await cookies()).get(ACCESS_COOKIE)?.value);
}

export async function navFor(): Promise<typeof ADMIN_NAV> {
  const roles = await currentRoles();
  return ADMIN_NAV.filter((n) => canAccessSection(roles, n.section));
}

/** Server components call this first; false means "show the no-access note", not an error page. */
export async function canOpen(section: AdminSection): Promise<boolean> {
  return canAccessSection(await currentRoles(), section);
}
