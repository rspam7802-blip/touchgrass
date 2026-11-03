import { z } from 'zod';
import { LIMITS } from '../constants';
import { RsvpStatus } from '../enums';
import { isValidRRule } from '../rrule';
import { EventWhere } from './events';
import { MediaVariants } from './media';
import { PersonCard } from './social';

const C = LIMITS.crews;
const P = LIMITS.proposals;
const A = LIMITS.availability;

// ---------- "I'm free now" (F-ENG-01) ----------

export const SetAvailabilityBody = z.object({
  hours: z.number().int().min(A.minHours).max(A.maxHours),
  note: z.string().trim().max(A.noteMaxLength).default(''),
});
export type SetAvailabilityBody = z.infer<typeof SetAvailabilityBody>;

export const MyAvailability = z.object({
  until: z.iso.datetime().nullable(),
  note: z.string(),
});
export type MyAvailability = z.infer<typeof MyAvailability>;

export const FreeNowItem = z.object({
  person: PersonCard,
  until: z.iso.datetime(),
  note: z.string(),
});
export type FreeNowItem = z.infer<typeof FreeNowItem>;
export const FreeNowList = z.object({ me: MyAvailability, items: z.array(FreeNowItem) });
export type FreeNowList = z.infer<typeof FreeNowList>;

// ---------- Crews (F-ENG-02) ----------

export const CrewJoinPolicy = z.enum(['request', 'invite_only']);
export type CrewJoinPolicy = z.infer<typeof CrewJoinPolicy>;
export const CrewRole = z.enum(['admin', 'member']);
export type CrewRole = z.infer<typeof CrewRole>;
export const CrewMemberStatus = z.enum(['active', 'requested', 'invited']);
export type CrewMemberStatus = z.infer<typeof CrewMemberStatus>;

const CrewFields = z.object({
  name: z.string().trim().min(C.nameMinLength).max(C.nameMaxLength),
  description: z.string().trim().max(C.descriptionMaxLength).default(''),
  /** What the crew does; its sessions use it as their category. */
  interestId: z.uuid(),
  coverMediaId: z.uuid().nullable().default(null),
  joinPolicy: CrewJoinPolicy.default('request'),
});
export const CreateCrewBody = CrewFields;
export type CreateCrewBody = z.infer<typeof CreateCrewBody>;
export const UpdateCrewBody = z
  .object({
    name: CrewFields.shape.name,
    description: z.string().trim().max(C.descriptionMaxLength),
    interestId: z.uuid(),
    coverMediaId: z.uuid().nullable(),
    joinPolicy: CrewJoinPolicy,
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, { message: 'Nothing to update' });
export type UpdateCrewBody = z.infer<typeof UpdateCrewBody>;

export const CrewRecurrenceBody = z.object({
  rrule: z
    .string()
    .trim()
    .max(200)
    .refine((r) => isValidRRule(r), { message: 'Unsupported recurrence rule' }),
  /** The first session's start; later sessions keep its IST time of day. */
  startsAt: z.iso.datetime(),
  durationMinutes: z.number().int().min(C.sessionMinMinutes).max(C.sessionMaxMinutes),
  where: EventWhere,
  capacity: z.number().int().min(LIMITS.event.minCapacity).max(LIMITS.event.maxCapacity),
  /** Session title; the crew's name when empty. */
  title: z.string().trim().max(LIMITS.event.titleMaxLength).default(''),
  active: z.boolean().default(true),
});
export type CrewRecurrenceBody = z.infer<typeof CrewRecurrenceBody>;

export const CrewRecurrence = z.object({
  rrule: z.string(),
  startsAt: z.iso.datetime(),
  durationMinutes: z.number().int(),
  capacity: z.number().int(),
  title: z.string(),
  placeLabel: z.string(),
  active: z.boolean(),
});
export type CrewRecurrence = z.infer<typeof CrewRecurrence>;

export const CrewViewer = z.object({
  role: CrewRole.nullable(),
  status: CrewMemberStatus.nullable(),
});

export const CrewSession = z.object({
  eventId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: z.enum(['published', 'cancelled', 'completed']),
  goingCount: z.number().int(),
  checkedInCount: z.number().int(),
  viewerRsvp: RsvpStatus.nullable(),
});
export type CrewSession = z.infer<typeof CrewSession>;

export const CrewSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  cover: MediaVariants.nullable(),
  interestId: z.uuid().nullable(),
  joinPolicy: CrewJoinPolicy,
  memberCount: z.number().int(),
  nextSession: z.object({ eventId: z.uuid(), startsAt: z.iso.datetime() }).nullable(),
  viewer: CrewViewer,
  /** Name or description is held for review: only members see the crew until then (F-SAF-06). */
  held: z.boolean(),
});
export type CrewSummary = z.infer<typeof CrewSummary>;

export const CrewMember = z.object({
  person: PersonCard,
  role: CrewRole,
  status: CrewMemberStatus,
  /** Sessions this person checked in to. */
  attended: z.number().int(),
  since: z.iso.datetime(),
});
export type CrewMember = z.infer<typeof CrewMember>;

export const CrewDetail = CrewSummary.extend({
  members: z.array(CrewMember),
  /** Join requests, admins only. */
  requests: z.array(CrewMember),
  recurrence: CrewRecurrence.nullable(),
  upcoming: z.array(CrewSession),
  canManage: z.boolean(),
});
export type CrewDetail = z.infer<typeof CrewDetail>;

export const CrewList = z.object({
  items: z.array(CrewSummary),
  nextCursor: z.string().nullable(),
});
export type CrewList = z.infer<typeof CrewList>;
export const CrewListQuery = z.object({
  scope: z.enum(['mine', 'discover']).default('mine'),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CrewListQuery = z.infer<typeof CrewListQuery>;

export const CrewHistory = z.object({
  items: z.array(CrewSession.extend({ attended: z.boolean() })),
  attendedCount: z.number().int(),
  nextCursor: z.string().nullable(),
});
export type CrewHistory = z.infer<typeof CrewHistory>;

export const CrewInviteBody = z.object({
  userIds: z.array(z.uuid()).min(1).max(C.maxInviteBatch),
});
export type CrewInviteBody = z.infer<typeof CrewInviteBody>;
export const CrewMemberActionBody = z.object({
  action: z.enum(['approve', 'decline', 'remove', 'make_admin', 'make_member']),
});
export type CrewMemberActionBody = z.infer<typeof CrewMemberActionBody>;
/** Join (policy "request"), accept an invite, or leave. */
export const CrewMembershipBody = z.object({
  action: z.enum(['join', 'accept', 'decline', 'leave']),
});
export type CrewMembershipBody = z.infer<typeof CrewMembershipBody>;

// ---------- Collaborative plans (F-ENG-03) ----------

export const ProposalStatus = z.enum(['open', 'locked', 'cancelled']);
export type ProposalStatus = z.infer<typeof ProposalStatus>;
export const ProposalOptionKind = z.enum(['time', 'place', 'activity']);
export type ProposalOptionKind = z.infer<typeof ProposalOptionKind>;

export const AddProposalOptionBody = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('time'),
    startsAt: z.iso.datetime(),
    durationMinutes: z.number().int().min(P.durationMinMinutes).max(P.durationMaxMinutes),
  }),
  z.object({ kind: z.literal('place'), where: EventWhere }),
  z.object({
    kind: z.literal('activity'),
    label: z.string().trim().min(2).max(P.optionLabelMaxLength),
    interestId: z.uuid().nullable().default(null),
  }),
]);
export type AddProposalOptionBody = z.infer<typeof AddProposalOptionBody>;

export const CreateProposalBody = z.object({
  title: z.string().trim().min(P.titleMinLength).max(P.titleMaxLength),
  description: z.string().trim().max(LIMITS.event.descriptionMaxLength).default(''),
  /** The kind of plan; a winning activity with its own interest takes over. */
  categoryInterestId: z.uuid(),
  inviteeIds: z.array(z.uuid()).max(P.maxInvitees).default([]),
  deadline: z.iso.datetime(),
  /** Lock automatically to the most-voted options at the deadline. */
  autoLock: z.boolean().default(true),
  capacity: z
    .number()
    .int()
    .min(LIMITS.event.minCapacity)
    .max(LIMITS.event.maxCapacity)
    .default(10),
  options: z.array(AddProposalOptionBody).max(P.maxOptions).default([]),
});
export type CreateProposalBody = z.infer<typeof CreateProposalBody>;

export const ProposalOption = z.object({
  id: z.uuid(),
  kind: ProposalOptionKind,
  /** Place name or activity label; time options are formatted by the client from `startsAt`. */
  label: z.string(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  address: z.string().nullable(),
  interestId: z.uuid().nullable(),
  votes: z.number().int(),
  voters: z.array(PersonCard),
  mine: z.boolean(),
  createdBy: PersonCard.nullable(),
});
export type ProposalOption = z.infer<typeof ProposalOption>;

export const ProposalDetail = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  status: ProposalStatus,
  deadline: z.iso.datetime(),
  autoLock: z.boolean(),
  capacity: z.number().int(),
  categoryInterestId: z.uuid().nullable(),
  creator: PersonCard,
  invitees: z.array(PersonCard),
  options: z.array(ProposalOption),
  eventId: z.uuid().nullable(),
  viewerIsCreator: z.boolean(),
  /** Open, and at least one time and one place to choose from. */
  canLock: z.boolean(),
  cancelledReason: z.string().nullable(),
  /** Held for review by the text filter: invitees see it once it's released (F-SAF-06). */
  held: z.boolean(),
});
export type ProposalDetail = z.infer<typeof ProposalDetail>;

export const ProposalSummary = z.object({
  id: z.uuid(),
  title: z.string(),
  status: ProposalStatus,
  deadline: z.iso.datetime(),
  creator: PersonCard,
  optionCount: z.number().int(),
  eventId: z.uuid().nullable(),
  /** Held for review by the text filter: invitees see it once it's released (F-SAF-06). */
  held: z.boolean(),
});
export type ProposalSummary = z.infer<typeof ProposalSummary>;
export const ProposalList = z.object({ items: z.array(ProposalSummary) });
export type ProposalList = z.infer<typeof ProposalList>;

export const ProposalVoteBody = z.object({ optionId: z.uuid(), vote: z.boolean() });
export type ProposalVoteBody = z.infer<typeof ProposalVoteBody>;
export const LockProposalBody = z.object({
  timeOptionId: z.uuid(),
  placeOptionId: z.uuid(),
  activityOptionId: z.uuid().nullable().default(null),
});
export type LockProposalBody = z.infer<typeof LockProposalBody>;

/** Most votes wins; ties go to the option suggested first (stable and explainable). */
export function pickWinner<T extends { votes: number; createdAt: Date; id: string }>(
  options: T[],
): T | null {
  let best: T | null = null;
  for (const o of options)
    if (
      !best ||
      o.votes > best.votes ||
      (o.votes === best.votes && o.createdAt.getTime() < best.createdAt.getTime())
    )
      best = o;
  return best;
}
