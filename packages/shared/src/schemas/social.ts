import { z } from 'zod';
import { LIMITS } from '../constants';
import { ReportCategory, ReportTargetType } from '../enums';
import { MediaVariants } from './media';

/** Where the viewer stands with another person. */
export const RelationshipStatus = z.enum([
  'self',
  'squad',
  'request_sent',
  'request_received',
  'none',
]);
export type RelationshipStatus = z.infer<typeof RelationshipStatus>;

/** Compact person card used in squad lists, suggestions, matches and activity. */
export const PersonCard = z.object({
  id: z.uuid(),
  displayName: z.string(),
  photo: MediaVariants.nullable(),
  verified: z.boolean(),
  mutualFriendCount: z.number().int(),
});
export type PersonCard = z.infer<typeof PersonCard>;

export const PersonList = z.object({
  items: z.array(PersonCard),
  nextCursor: z.string().nullable(),
});
export type PersonList = z.infer<typeof PersonList>;

export const FriendRequestBody = z.object({ userId: z.uuid() });
export type FriendRequestBody = z.infer<typeof FriendRequestBody>;
export const FriendRequestResult = z.object({ relationship: RelationshipStatus });
export type FriendRequestResult = z.infer<typeof FriendRequestResult>;

export const FriendRequest = z.object({
  person: PersonCard,
  direction: z.enum(['incoming', 'outgoing']),
  createdAt: z.iso.datetime(),
});
export type FriendRequest = z.infer<typeof FriendRequest>;
export const FriendRequestList = z.object({ items: z.array(FriendRequest) });

/** At most 5,000 SHA-256 hex hashes of E.164 numbers per upload (F-SOC-01). Raw numbers are never sent. */
export const ContactHash = z.string().regex(/^[0-9a-f]{64}$/);
export const ContactMatchBody = z.object({
  hashes: z.array(ContactHash).min(1).max(LIMITS.social.maxContactHashes),
});
export type ContactMatchBody = z.infer<typeof ContactMatchBody>;
export const ContactMatch = z.object({
  hash: ContactHash,
  person: PersonCard,
  relationship: RelationshipStatus,
});
export type ContactMatch = z.infer<typeof ContactMatch>;
export const ContactMatchResponse = z.object({ items: z.array(ContactMatch) });
export type ContactMatchResponse = z.infer<typeof ContactMatchResponse>;

export const SuggestionReason = z.enum([
  'mutual_friends',
  'contact',
  'shared_interests',
  'shared_events',
]);
export type SuggestionReason = z.infer<typeof SuggestionReason>;
export const Suggestion = z.object({
  person: PersonCard,
  reasons: z.array(SuggestionReason),
  sharedInterestCount: z.number().int(),
  score: z.number(),
});
export type Suggestion = z.infer<typeof Suggestion>;
export const SuggestionList = z.object({ items: z.array(Suggestion) });

export const BlockBody = z.object({ userId: z.uuid() });
export type BlockBody = z.infer<typeof BlockBody>;
export const BlockedList = z.object({
  items: z.array(z.object({ id: z.uuid(), displayName: z.string(), blockedAt: z.iso.datetime() })),
});
export type BlockedList = z.infer<typeof BlockedList>;

export const CreateReportBody = z.object({
  targetType: ReportTargetType,
  targetId: z.uuid(),
  category: ReportCategory,
  details: z.string().trim().max(LIMITS.social.reportDetailsMax).default(''),
  screenshotMediaIds: z.array(z.uuid()).max(3).default([]),
  alsoBlock: z.boolean().default(false),
});
export type CreateReportBody = z.infer<typeof CreateReportBody>;
export const ReportCreated = z.object({
  id: z.uuid(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
});

export const ActivityVerb = z.enum([
  'joined',
  'squad_joined',
  'pulled_up',
  'plotted',
  'badge_earned',
  'lore_posted',
]);
export type ActivityVerb = z.infer<typeof ActivityVerb>;
export const ActivityItem = z.object({
  id: z.uuid(),
  verb: ActivityVerb,
  actor: PersonCard,
  /** Second person for person-to-person activity (e.g. squad_joined). */
  subject: PersonCard.nullable(),
  /** Event/badge/Lore reference for later phases; title is already localised server-side when present. */
  object: z.object({ type: z.string(), id: z.uuid(), title: z.string().nullable() }).nullable(),
  createdAt: z.iso.datetime(),
});
export type ActivityItem = z.infer<typeof ActivityItem>;
export const ActivityFeed = z.object({
  items: z.array(ActivityItem),
  nextCursor: z.string().nullable(),
});
export type ActivityFeed = z.infer<typeof ActivityFeed>;

export const ModerationQueueItem = z.object({
  id: z.uuid(),
  targetType: z.string(),
  targetId: z.uuid(),
  source: z.string(),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  status: z.string(),
  details: z.record(z.string(), z.unknown()),
  reportCount: z.number().int(),
  createdAt: z.iso.datetime(),
});
export type ModerationQueueItem = z.infer<typeof ModerationQueueItem>;
