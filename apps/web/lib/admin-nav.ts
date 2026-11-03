import { type AdminSection, canAccessSection, resources } from '@touchgrass/shared';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, rolesFromToken } from './admin-session';

const t = resources.en.admin;
const c = t.console;

/** Every dashboard section, in menu order, with the shared role matrix deciding who sees it (F-WEB-03). */
export const ADMIN_NAV: { section: AdminSection; href: string; label: string }[] = [
  { section: 'dashboard', href: '/admin', label: t.dashboard },
  { section: 'analytics', href: '/admin/analytics', label: c.analytics },
  { section: 'users', href: '/admin/users', label: t.users },
  { section: 'verifications', href: '/admin/verifications', label: t.verifications },
  { section: 'moderation', href: '/admin/moderation', label: t.moderation },
  { section: 'events', href: '/admin/events', label: c.events },
  { section: 'cities', href: '/admin/cities', label: c.cities },
  { section: 'venues', href: '/admin/venues', label: t.venuesPerks },
  { section: 'hostApplications', href: '/admin/host-applications', label: t.hostApplications },
  { section: 'icebreakers', href: '/admin/icebreakers', label: t.icebreakers },
  { section: 'taxonomy', href: '/admin/taxonomy', label: c.taxonomy },
  { section: 'badges', href: '/admin/badges', label: t.badges },
  { section: 'challenges', href: '/admin/challenges', label: t.challenges },
  { section: 'feedback', href: '/admin/feedback', label: t.feedback },
  { section: 'payments', href: '/admin/payments', label: t.payments },
  { section: 'inviteCodes', href: '/admin/invite-codes', label: t.inviteCodes },
  { section: 'weights', href: '/admin/weights', label: c.weights },
  { section: 'notificationTemplates', href: '/admin/notification-templates', label: c.templates },
  { section: 'featureFlags', href: '/admin/feature-flags', label: t.featureFlags },
  { section: 'settings', href: '/admin/settings', label: t.settings },
  { section: 'team', href: '/admin/team', label: c.team },
  { section: 'auditLog', href: '/admin/audit-log', label: t.auditLog },
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
