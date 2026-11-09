import { z } from 'zod';
import { LIMITS, LOCALE_DEFAULTS } from '../constants';
import { ReliabilityTier } from '../enums';
import { MediaVariants } from './media';
import { PersonCard } from './social';

const A = LIMITS.after;

// ---------- feedback and host ratings (F-AFT-02, F-AFT-05) ----------

export const GREAT_TAGS = [
  'welcoming',
  'well_organised',
  'great_people',
  'great_venue',
  'fun_activity',
  'good_value',
] as const;
export const IMPROVE_TAGS = [
  'started_late',
  'too_crowded',
  'hard_to_find',
  'too_loud',
  'host_absent',
  'not_as_described',
] as const;
export const GreatTag = z.enum(GREAT_TAGS);
export const ImproveTag = z.enum(IMPROVE_TAGS);
export type GreatTag = z.infer<typeof GreatTag>;
export type ImproveTag = z.infer<typeof ImproveTag>;

const Stars = z.number().int().min(1).max(5);

export const FeedbackBody = z.object({
  rating: Stars,
  /** The primary host's rating; omitted when the person would rather not rate them. */
  hostRating: Stars.nullable().default(null),
  great: z.array(GreatTag).max(GREAT_TAGS.length).default([]),
  improve: z.array(ImproveTag).max(IMPROVE_TAGS.length).default([]),
  /** Private to the hosts; never shown with a name. */
  comment: z.string().trim().max(A.commentMaxLength).default(''),
});
export type FeedbackBody = z.infer<typeof FeedbackBody>;

export const MyFeedback = FeedbackBody.extend({ createdAt: z.iso.datetime() });
export type MyFeedback = z.infer<typeof MyFeedback>;

export const TagCount = z.object({ tag: z.string(), count: z.number().int() });
export const FeedbackSummary = z.object({
  eventId: z.uuid(),
  count: z.number().int(),
  averageRating: z.number().nullable(),
  hostAverage: z.number().nullable(),
  hostCount: z.number().int(),
  great: z.array(TagCount),
  improve: z.array(TagCount),
  /** Anonymous comments, newest first. */
  comments: z.array(z.object({ comment: z.string(), rating: Stars, createdAt: z.iso.datetime() })),
});
export type FeedbackSummary = z.infer<typeof FeedbackSummary>;

export const HostRatingSummary = z.object({
  average: z.number().nullable(),
  count: z.number().int(),
});
export type HostRatingSummary = z.infer<typeof HostRatingSummary>;

/** Average to one decimal, null without ratings. Shown only from `LIMITS.after.minRatingsToShow` ratings. */
export function averageRating(sum: number, count: number): number | null {
  return count === 0 ? null : Math.round((sum / count) * 10) / 10;
}

// ---------- reconnect / mutual pull (F-AFT-03) ----------

export const ReconnectState = z.enum(['none', 'pulled', 'pulled_you', 'squad', 'request_sent']);
export type ReconnectState = z.infer<typeof ReconnectState>;
export const ReconnectCandidate = z.object({ person: PersonCard, state: ReconnectState });
export type ReconnectCandidate = z.infer<typeof ReconnectCandidate>;
export const ReconnectList = z.object({ items: z.array(ReconnectCandidate) });
export type ReconnectList = z.infer<typeof ReconnectList>;
export const PullResult = z.object({ state: ReconnectState });
export type PullResult = z.infer<typeof PullResult>;

// ---------- post-event screen (F-AFT-01) ----------

export const EarnedBadge = z.object({
  key: z.string(),
  name: z.string(),
  emoji: z.string(),
});
export type EarnedBadge = z.infer<typeof EarnedBadge>;

export const PostEventCard = z.object({
  event: z.object({
    id: z.uuid(),
    title: z.string(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    timezone: z.string().default(LOCALE_DEFAULTS.timezone),
    cover: MediaVariants.nullable(),
  }),
  host: PersonCard.nullable(),
  feedback: MyFeedback.nullable(),
  feedbackOpenUntil: z.iso.datetime(),
  people: z.array(ReconnectCandidate),
  loreCount: z.number().int(),
  canAddLore: z.boolean(),
  badges: z.array(EarnedBadge),
});
export type PostEventCard = z.infer<typeof PostEventCard>;
export const PendingPostEvent = z.object({ card: PostEventCard.nullable() });
export type PendingPostEvent = z.infer<typeof PendingPostEvent>;

// ---------- Lore (F-AFT-04) ----------

export const LoreVisibility = z.enum(['attendees', 'friends_of_attendees']);
export type LoreVisibility = z.infer<typeof LoreVisibility>;

export const LoreItem = z.object({
  id: z.uuid(),
  image: MediaVariants,
  caption: z.string(),
  /** Your caption tripped the text filter: others don't see it until it's reviewed (F-SAF-06). */
  captionHeld: z.boolean(),
  uploader: PersonCard,
  mine: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type LoreItem = z.infer<typeof LoreItem>;

export const LoreAlbum = z.object({
  eventId: z.uuid(),
  eventTitle: z.string(),
  visibility: LoreVisibility,
  cover: MediaVariants.nullable(),
  count: z.number().int(),
  canAdd: z.boolean(),
  /** Hosts choose who sees the album. */
  canManage: z.boolean(),
  items: z.array(LoreItem),
  nextCursor: z.string().nullable(),
});
export type LoreAlbum = z.infer<typeof LoreAlbum>;

export const LoreQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(30),
});
export type LoreQuery = z.infer<typeof LoreQuery>;

export const AddLoreBody = z.object({
  mediaId: z.uuid(),
  caption: z.string().trim().max(A.captionMaxLength).default(''),
});
export type AddLoreBody = z.infer<typeof AddLoreBody>;
export const LoreVisibilityBody = z.object({ visibility: LoreVisibility });
export type LoreVisibilityBody = z.infer<typeof LoreVisibilityBody>;

/** Full-size, short-lived links for the photos this viewer may keep (blocked people's photos left out). */
export const LoreDownload = z.object({
  items: z.array(z.object({ id: z.uuid(), url: z.url() })),
  expiresAt: z.iso.datetime(),
});
export type LoreDownload = z.infer<typeof LoreDownload>;

// ---------- reliability (F-SAF-02) ----------

export type ReliabilityKind = 'check_in' | 'no_show' | 'late_cancel';

export interface ReliabilityEventInput {
  kind: ReliabilityKind;
  at: Date;
}

export interface ReliabilityOutcome {
  /** 0–100; internal only, never shown. */
  score: number;
  tier: ReliabilityTier;
  noShowsRecent: number;
  cooldownUntil: Date | null;
}

const R = LIMITS.reliability;

/**
 * Reliability (F-SAF-02): check-ins against no-shows and late cancellations, recent ones weighing more
 * (half-life `R.halfLifeDays`). Fewer than `R.minCommitments` commitments in a year is still "new". Repeat
 * no-shows (`R.cooldownNoShows` within `R.cooldownWindowDays`) start a cooldown on popular plans.
 */
export function reliabilityOutcome(events: ReliabilityEventInput[], now: Date): ReliabilityOutcome {
  const day = 86_400_000;
  let kept = 0;
  let missed = 0;
  let commitments = 0;
  let noShowsRecent = 0;
  let lastNoShow: Date | null = null;
  for (const e of events) {
    const ageDays = Math.max(0, (now.getTime() - e.at.getTime()) / day);
    if (ageDays > 365) continue;
    commitments += 1;
    const w = 0.5 ** (ageDays / R.halfLifeDays);
    if (e.kind === 'check_in') kept += w;
    else if (e.kind === 'no_show') {
      missed += w;
      if (ageDays <= R.cooldownWindowDays) {
        noShowsRecent += 1;
        if (!lastNoShow || e.at > lastNoShow) lastNoShow = e.at;
      }
    } else missed += w * R.lateCancelWeight;
  }
  const score = kept + missed === 0 ? 100 : Math.round((kept / (kept + missed)) * 1000) / 10;
  const tier: ReliabilityTier =
    commitments < R.minCommitments
      ? 'new'
      : score >= 95
        ? 'super_reliable'
        : score >= 80
          ? 'reliable'
          : score >= 60
            ? 'hit_or_miss'
            : 'flaky';
  const cooldownEnd =
    noShowsRecent >= R.cooldownNoShows && lastNoShow
      ? new Date(lastNoShow.getTime() + R.cooldownDays * day)
      : null;
  return {
    score,
    tier,
    noShowsRecent,
    cooldownUntil: cooldownEnd && cooldownEnd > now ? cooldownEnd : null,
  };
}

/** A plan is "popular" (cooldowns apply) when it is nearly full or already has a waitlist. */
export function isPopularPlan(capacity: number, seatsTaken: number, waitlisted: number): boolean {
  return waitlisted > 0 || capacity - seatsTaken <= Math.ceil(capacity * R.popularSpotsShare);
}

// ---------- admin ----------

export const AdminFeedbackRow = z.object({
  eventId: z.uuid(),
  eventTitle: z.string(),
  startsAt: z.iso.datetime(),
  host: PersonCard,
  count: z.number().int(),
  averageRating: z.number().nullable(),
  hostAverage: z.number().nullable(),
  topImprove: z.array(TagCount),
});
export type AdminFeedbackRow = z.infer<typeof AdminFeedbackRow>;
export const AdminFeedbackList = z.object({
  items: z.array(AdminFeedbackRow),
  nextCursor: z.string().nullable(),
});
export const AdminFeedbackQuery = z.object({
  sort: z.enum(['recent', 'lowest']).default('recent'),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminFeedbackQuery = z.infer<typeof AdminFeedbackQuery>;
