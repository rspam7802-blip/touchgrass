import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from '../constants';
import { EventStatus, Gender, ReliabilityTier } from '../enums';
import { HostRatingSummary } from './after';
import { MediaVariants } from './media';
import { AdminUserSummary, UserSanction } from './safety';

/**
 * Customer 360 (D-192): one person's whole story for staff. Admins (and super admins) see everything; support
 * sees profile, plans and social only (no money, no safety reports). Private chats, live-location trails, who
 * someone blocked and their contacts are never part of it. Every view is written to the audit log.
 */
export const CustomerAccess = z.enum(['full', 'support']);
export type CustomerAccess = z.infer<typeof CustomerAccess>;

/** Staff who may open Customer 360, and how much they see. Moderators keep the standing page only. */
export function customerAccessFor(roles: readonly string[]): CustomerAccess | null {
  if (roles.includes('super_admin') || roles.includes('admin')) return 'full';
  if (roles.includes('support')) return 'support';
  return null;
}

export const CustomerPlanRsvp = z.enum([
  'going',
  'interested',
  'waitlisted',
  'cancelled',
  'checked_in',
  'held',
]);
export type CustomerPlanRsvp = z.infer<typeof CustomerPlanRsvp>;

export const CustomerPlan = z.object({
  eventId: z.uuid(),
  title: z.string(),
  startsAt: z.iso.datetime(),
  eventStatus: EventStatus,
  cityName: z.string().nullable(),
  timezone: z.string(),
  role: z.enum(['host', 'co_host', 'welcome_host', 'guest']),
  rsvp: CustomerPlanRsvp.nullable(),
  pulledUpAt: z.iso.datetime().nullable(),
  checkedInAt: z.iso.datetime().nullable(),
  lateCancel: z.boolean(),
  noShow: z.boolean(),
  /** Stars this person gave the plan afterwards. */
  ratingGiven: z.number().int().nullable(),
  /** Full view only. */
  paidPaise: z.number().int().nullable(),
});
export type CustomerPlan = z.infer<typeof CustomerPlan>;

export const CustomerPlanStats = z.object({
  pulledUp: z.number().int(),
  checkedIn: z.number().int(),
  upcoming: z.number().int(),
  cancelled: z.number().int(),
  lateCancels: z.number().int(),
  noShows: z.number().int(),
  hosted: z.number().int(),
});
export type CustomerPlanStats = z.infer<typeof CustomerPlanStats>;

export const CustomerPerson = z.object({ id: z.uuid(), name: z.string().nullable() });
export type CustomerPerson = z.infer<typeof CustomerPerson>;

export const CustomerTimelineKind = z.enum([
  'joined',
  'invited_by',
  'onboarded',
  'pulled_up',
  'checked_in',
  'cancelled',
  'hosted',
  'invited_someone',
  'sanction',
  'sos',
]);
export type CustomerTimelineKind = z.infer<typeof CustomerTimelineKind>;

export const CustomerTimelineItem = z.object({
  at: z.iso.datetime(),
  kind: CustomerTimelineKind,
  eventId: z.uuid().nullable(),
  /** Plan title, the other person's name or the sanction kind, depending on `kind`. */
  label: z.string().nullable(),
  personId: z.uuid().nullable(),
});
export type CustomerTimelineItem = z.infer<typeof CustomerTimelineItem>;

export const CustomerSpend = z.object({
  paidPaise: z.number().int(),
  refundedPaise: z.number().int(),
  payments: z.number().int(),
  lastPaidAt: z.iso.datetime().nullable(),
  hostEarnedPaise: z.number().int(),
  priorityPasses: z.number().int(),
  credits: z.number().int(),
});
export type CustomerSpend = z.infer<typeof CustomerSpend>;

export const CustomerSafety = z.object({
  reportsAgainst: z.number().int(),
  reportsMade: z.number().int(),
  sanctions: z.array(UserSanction),
  mutedUntil: z.iso.datetime().nullable(),
  suspendedUntil: z.iso.datetime().nullable(),
  sosCount: z.number().int(),
  lastSosAt: z.iso.datetime().nullable(),
  trustedContacts: z.number().int(),
});
export type CustomerSafety = z.infer<typeof CustomerSafety>;

export const CustomerView = z.object({
  access: CustomerAccess,
  user: AdminUserSummary,
  /** Full view only; support sees the last four digits in `user`. */
  phone: z.string().nullable(),
  email: z.string().nullable(),
  photo: MediaVariants.nullable(),
  roles: z.array(z.string()),
  lastActiveAt: z.iso.datetime().nullable(),
  onboardedAt: z.iso.datetime().nullable(),
  profile: z.object({
    bio: z.string(),
    age: z.number().int().nullable(),
    gender: Gender.nullable(),
    pronouns: z.string().nullable(),
    city: z.string().nullable(),
    neighbourhood: z.string().nullable(),
    spokenLanguages: z.array(z.string()),
    appLanguage: z.enum(SUPPORTED_LANGUAGES),
    interests: z.array(z.string()),
  }),
  invitedBy: CustomerPerson.nullable(),
  invitedAt: z.iso.datetime().nullable(),
  invitees: z.array(CustomerPerson.extend({ at: z.iso.datetime() })),
  stats: CustomerPlanStats,
  reliability: z.object({ tier: ReliabilityTier, cooldownUntil: z.iso.datetime().nullable() }),
  hostRating: HostRatingSummary,
  ratingsGiven: z.object({ count: z.number().int(), average: z.number().nullable() }),
  plans: z.array(CustomerPlan),
  social: z.object({
    squad: z.number().int(),
    crews: z.array(z.object({ id: z.uuid(), name: z.string() })),
  }),
  spend: CustomerSpend.nullable(),
  safety: CustomerSafety.nullable(),
  timeline: z.array(CustomerTimelineItem),
});
export type CustomerView = z.infer<typeof CustomerView>;
