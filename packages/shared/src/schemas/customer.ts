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

// ---------- invite network (D-193) ----------

/** How someone got in: a team (admin) code, a member's code, or without any code (seeded, gate off). */
export const NetworkEntry = z.enum(['team', 'member', 'open']);
export type NetworkEntry = z.infer<typeof NetworkEntry>;

export const NetworkNode = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  status: z.string(),
  joinedAt: z.iso.datetime(),
  entry: NetworkEntry,
  inviterId: z.uuid().nullable(),
  /** The team code's label (or the code itself) for generation 1. */
  codeLabel: z.string().nullable(),
  /** 1 = came in through us (or with no code); 2 = invited by a generation-1 member; and so on. */
  generation: z.number().int().min(1),
  direct: z.number().int(),
  descendants: z.number().int(),
});
export type NetworkNode = z.infer<typeof NetworkNode>;

export const InviteNetworkQuery = z.object({
  /** Only people who joined up to the end of this IST day (the time slider). */
  until: z.iso.date().optional(),
  /** Show one family: this person and everyone they brought in, at any depth. */
  root: z.uuid().optional(),
});
export type InviteNetworkQuery = z.infer<typeof InviteNetworkQuery>;

export const InviteNetwork = z.object({
  nodes: z.array(NetworkNode),
  truncated: z.boolean(),
  firstJoinedAt: z.iso.datetime().nullable(),
  stats: z.object({
    people: z.number().int(),
    team: z.number().int(),
    member: z.number().int(),
    open: z.number().int(),
    deepest: z.number().int(),
    byGeneration: z.array(z.object({ generation: z.number().int(), count: z.number().int() })),
    topInviters: z.array(
      z.object({
        id: z.uuid(),
        name: z.string().nullable(),
        direct: z.number().int(),
        descendants: z.number().int(),
      }),
    ),
  }),
});
export type InviteNetwork = z.infer<typeof InviteNetwork>;

export interface NetworkPerson {
  id: string;
  joinedAt: Date;
  inviterId: string | null;
  entry: NetworkEntry;
}

/**
 * Generations and family sizes for the invite forest. Roots are people nobody invited (or whose inviter is not
 * in the list); cycles cannot happen (an inviter joined first) but are cut defensively.
 */
export function inviteForest(
  people: readonly NetworkPerson[],
): Map<string, { generation: number; direct: number; descendants: number }> {
  const byId = new Map(people.map((p) => [p.id, p]));
  const children = new Map<string, string[]>();
  for (const p of people)
    if (p.inviterId && byId.has(p.inviterId) && p.inviterId !== p.id)
      children.set(p.inviterId, [...(children.get(p.inviterId) ?? []), p.id]);
  const out = new Map<string, { generation: number; direct: number; descendants: number }>();
  const roots = people.filter(
    (p) => !p.inviterId || !byId.has(p.inviterId) || p.inviterId === p.id,
  );
  const visit = (id: string, generation: number, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const kids = children.get(id) ?? [];
    let descendants = 0;
    for (const k of kids) descendants += 1 + visit(k, generation + 1, seen);
    out.set(id, { generation, direct: kids.length, descendants });
    return descendants;
  };
  const seen = new Set<string>();
  for (const r of roots) visit(r.id, 1, seen);
  // Anything left sits on a cycle: treat it as a root.
  for (const p of people) if (!seen.has(p.id)) visit(p.id, 1, seen);
  return out;
}
