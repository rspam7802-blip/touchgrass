import { z } from 'zod';
import { LIMITS } from '../constants';
import { isoWeekKey } from '../time';
import { PersonCard } from './social';

const G = LIMITS.gamification;

/** Text an admin writes in all three app languages. */
export const LocalizedText = z.object({
  en: z.string().trim().min(1),
  te: z.string().trim().min(1),
  hi: z.string().trim().min(1),
});
export type LocalizedText = z.infer<typeof LocalizedText>;

// ---------- facts and badge rules (F-GAM-01) ----------

/** What the gamification ledger records, one row per person and thing (so replays never double count). */
export const FactKind = z.enum([
  'check_in',
  'hosted',
  'reconnect',
  'crew_session',
  'lore_photo',
  'challenge_completed',
  'referral',
]);
export type FactKind = z.infer<typeof FactKind>;
export const FactField = z.enum(['eventId', 'venueId', 'neighbourhoodId', 'crewId', 'otherUserId']);
export type FactField = z.infer<typeof FactField>;

const Threshold = z.number().int().min(1).max(G.maxRuleThreshold);

/**
 * The rule types admins can combine without code (F-GAM-01): how many facts of a kind (optionally only
 * on-time check-ins), how many distinct values of a field (e.g. neighbourhoods), or the most facts inside
 * one group (e.g. sessions of the same crew).
 */
export const BadgeRule = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('count'),
    fact: FactKind,
    threshold: Threshold,
    onTimeOnly: z.boolean().default(false),
  }),
  z.object({ type: z.literal('distinct'), fact: FactKind, field: FactField, threshold: Threshold }),
  z.object({
    type: z.literal('group_count'),
    fact: FactKind,
    field: FactField,
    threshold: Threshold,
  }),
]);
export type BadgeRule = z.infer<typeof BadgeRule>;

export interface FactRow {
  kind: FactKind;
  attrs: Partial<Record<FactField, string | null>> & { onTime?: boolean };
}

/** Progress of one person towards a rule: how far along, capped at the threshold. */
export function ruleProgress(
  rule: BadgeRule,
  facts: FactRow[],
): { current: number; target: number } {
  const relevant = facts.filter((f) => f.kind === rule.fact);
  let current = 0;
  switch (rule.type) {
    case 'count':
      current = relevant.filter((f) => !rule.onTimeOnly || f.attrs.onTime === true).length;
      break;
    case 'distinct': {
      const values = new Set<string>();
      for (const f of relevant) {
        const v = f.attrs[rule.field];
        if (typeof v === 'string' && v.length > 0) values.add(v);
      }
      current = values.size;
      break;
    }
    case 'group_count': {
      const groups = new Map<string, number>();
      for (const f of relevant) {
        const v = f.attrs[rule.field];
        if (typeof v === 'string' && v.length > 0) groups.set(v, (groups.get(v) ?? 0) + 1);
      }
      current = Math.max(0, ...groups.values());
      break;
    }
  }
  return { current: Math.min(current, rule.threshold), target: rule.threshold };
}

export const BadgeKey = z
  .string()
  .regex(/^[a-z0-9_]{3,40}$/, 'Lowercase letters, digits and underscores');

export const UpsertBadgeBody = z.object({
  key: BadgeKey,
  name: LocalizedText.refine((t) =>
    Object.values(t).every((v) => v.length <= G.badgeNameMaxLength),
  ),
  description: LocalizedText.refine((t) =>
    Object.values(t).every((v) => v.length <= G.badgeDescriptionMaxLength),
  ),
  emoji: z.string().trim().min(1).max(8),
  rule: BadgeRule,
  active: z.boolean().default(true),
});
export type UpsertBadgeBody = z.infer<typeof UpsertBadgeBody>;

export const AdminBadge = UpsertBadgeBody.extend({
  id: z.uuid(),
  builtin: z.boolean(),
  earnedCount: z.number().int(),
});
export type AdminBadge = z.infer<typeof AdminBadge>;
export const AdminBadgeList = z.object({ items: z.array(AdminBadge) });

export const BadgeView = z.object({
  key: z.string(),
  name: LocalizedText,
  description: LocalizedText,
  emoji: z.string(),
  earnedAt: z.iso.datetime().nullable(),
  progress: z.object({ current: z.number().int(), target: z.number().int() }),
});
export type BadgeView = z.infer<typeof BadgeView>;
export const BadgeList = z.object({ items: z.array(BadgeView) });
export type BadgeList = z.infer<typeof BadgeList>;

// ---------- streaks (F-GAM-02) ----------

export const WeekState = z.enum(['out', 'freeze', 'none']);
export type WeekState = z.infer<typeof WeekState>;

export const StreakView = z.object({
  current: z.number().int(),
  longest: z.number().int(),
  /** This ISO week already counts (a check-in, or a freeze). */
  thisWeek: z.boolean(),
  /** A streak is going and this week doesn't count yet. */
  atRisk: z.boolean(),
  /** A freeze is left for this month. */
  freezeAvailable: z.boolean(),
  weekKey: z.string(),
  /** Oldest first, ending with this week. */
  recentWeeks: z.array(z.object({ week: z.string(), state: WeekState })),
});
export type StreakView = z.infer<typeof StreakView>;

const WEEK_RE = /^(\d{4})-W(\d{2})$/;

/** Monday 00:00 UTC of an ISO week key (used only for week arithmetic). */
export function isoWeekMonday(key: string): Date {
  const m = WEEK_RE.exec(key);
  if (!m) throw new RangeError(`Not an ISO week: ${key}`);
  const year = Number(m[1]);
  const week = Number(m[2]);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Weekday = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  return new Date(jan4.getTime() + ((week - 1) * 7 - (jan4Weekday - 1)) * 86_400_000);
}

export function shiftIsoWeek(key: string, weeks: number): string {
  // Noon UTC keeps the shifted date inside the same IST calendar day.
  return isoWeekKey(
    new Date(isoWeekMonday(key).getTime() + weeks * 7 * 86_400_000 + 12 * 3_600_000),
  );
}

/** "YYYY-MM" of the Monday that starts an ISO week; a freeze counts against that month. */
export function freezeMonth(week: string): string {
  return isoWeekMonday(week).toISOString().slice(0, 7);
}

/**
 * Weekly outside streak: consecutive ISO weeks with a check-in (or a freeze). The current week still in
 * progress doesn't break it; it only adds once it counts.
 */
export function streakState(
  outWeeks: ReadonlySet<string>,
  freezeWeeks: ReadonlySet<string>,
  currentWeek: string,
): { current: number; longest: number; thisWeek: boolean } {
  const covered = (w: string): boolean => outWeeks.has(w) || freezeWeeks.has(w);
  const thisWeek = covered(currentWeek);
  let current = 0;
  for (
    let w = thisWeek ? currentWeek : shiftIsoWeek(currentWeek, -1);
    covered(w);
    w = shiftIsoWeek(w, -1)
  )
    current += 1;
  const all = [...new Set([...outWeeks, ...freezeWeeks])].sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const w of all) {
    run = prev !== null && shiftIsoWeek(prev, 1) === w ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = w;
  }
  return { current, longest: Math.max(longest, current), thisWeek };
}

/**
 * Whether a missed week should be frozen automatically: the streak was alive the week before, nothing
 * counted in the missed week, and no freeze was used in that week's month yet.
 */
export function shouldFreeze(
  outWeeks: ReadonlySet<string>,
  freezeWeeks: ReadonlySet<string>,
  missedWeek: string,
): boolean {
  if (outWeeks.has(missedWeek) || freezeWeeks.has(missedWeek)) return false;
  const before = shiftIsoWeek(missedWeek, -1);
  if (!outWeeks.has(before) && !freezeWeeks.has(before)) return false;
  const month = freezeMonth(missedWeek);
  const used = [...freezeWeeks].filter((w) => freezeMonth(w) === month).length;
  return used < G.freezesPerMonth;
}

// ---------- challenges (F-GAM-03) ----------

export const ChallengeMode = z.enum(['solo', 'group']);
export type ChallengeMode = z.infer<typeof ChallengeMode>;

/** What counts: check-ins during the challenge, optionally only in a category, at new places, with squad. */
export const ChallengeCriteria = z.object({
  target: z.number().int().min(1).max(100),
  /** Count distinct venues or neighbourhoods instead of check-ins. */
  distinct: z.enum(['venueId', 'neighbourhoodId']).nullable().default(null),
  categoryInterestId: z.uuid().nullable().default(null),
  /** Only places the person hadn't checked in at before the challenge started. */
  newPlacesOnly: z.boolean().default(false),
  /** Only plans where someone from their squad also checked in. */
  withSquad: z.boolean().default(false),
});
export type ChallengeCriteria = z.infer<typeof ChallengeCriteria>;

export const UpsertChallengeBody = z
  .object({
    title: LocalizedText.refine((t) =>
      Object.values(t).every((v) => v.length <= G.challengeTitleMaxLength),
    ),
    description: LocalizedText.refine((t) =>
      Object.values(t).every((v) => v.length <= G.challengeDescriptionMaxLength),
    ),
    emoji: z.string().trim().min(1).max(8),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    mode: ChallengeMode,
    criteria: ChallengeCriteria,
    rewardBadgeId: z.uuid().nullable().default(null),
    active: z.boolean().default(true),
  })
  .refine((b) => new Date(b.endsAt) > new Date(b.startsAt), {
    message: 'Ends after it starts',
    path: ['endsAt'],
  });
export type UpsertChallengeBody = z.infer<typeof UpsertChallengeBody>;

export const AdminChallenge = z.object({
  id: z.uuid(),
  title: LocalizedText,
  description: LocalizedText,
  emoji: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  mode: ChallengeMode,
  criteria: ChallengeCriteria,
  rewardBadgeId: z.uuid().nullable(),
  active: z.boolean(),
  participants: z.number().int(),
  completed: z.number().int(),
});
export type AdminChallenge = z.infer<typeof AdminChallenge>;
export const AdminChallengeList = z.object({ items: z.array(AdminChallenge) });

export const ChallengeView = z.object({
  id: z.uuid(),
  title: LocalizedText,
  description: LocalizedText,
  emoji: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  mode: ChallengeMode,
  target: z.number().int(),
  rewardBadge: z.object({ key: z.string(), name: LocalizedText, emoji: z.string() }).nullable(),
  state: z.enum(['upcoming', 'active', 'ended']),
  joined: z.boolean(),
  team: z.object({ crewId: z.uuid(), crewName: z.string() }).nullable(),
  progress: z.number().int(),
  completedAt: z.iso.datetime().nullable(),
});
export type ChallengeView = z.infer<typeof ChallengeView>;
export const ChallengeList = z.object({ items: z.array(ChallengeView) });
export type ChallengeList = z.infer<typeof ChallengeList>;
export const JoinChallengeBody = z.object({ crewId: z.uuid().nullable().default(null) });
export type JoinChallengeBody = z.infer<typeof JoinChallengeBody>;

// ---------- recaps (F-GAM-04) ----------

export const RecapPeriod = z.enum(['month', 'year']);
export type RecapPeriod = z.infer<typeof RecapPeriod>;

export const RecapStats = z.object({
  eventsAttended: z.number().int(),
  eventsHosted: z.number().int(),
  peopleMet: z.number().int(),
  neighbourhoods: z.array(z.string()),
  topVibe: LocalizedText.nullable(),
  longestStreak: z.number().int(),
  badges: z.array(z.object({ key: z.string(), name: LocalizedText, emoji: z.string() })),
  /** Up to three people they were at the most plans with this period. */
  topPeople: z.array(PersonCard),
});
export type RecapStats = z.infer<typeof RecapStats>;

export const Recap = z.object({
  id: z.uuid(),
  period: RecapPeriod,
  /** "2026-10" for a month, "2026" for a year. */
  key: z.string(),
  stats: RecapStats,
  createdAt: z.iso.datetime(),
});
export type Recap = z.infer<typeof Recap>;
export const RecapList = z.object({ items: z.array(Recap) });
export type RecapList = z.infer<typeof RecapList>;

/** The IST month ("YYYY-MM") or year a recap covers, as [start, end) instants. */
export function recapWindow(period: RecapPeriod, key: string): { from: Date; to: Date } {
  const ist = 330 * 60_000;
  if (period === 'year') {
    if (!/^\d{4}$/.test(key)) throw new RangeError(`Bad recap year ${key}`);
    const y = Number(key);
    return { from: new Date(Date.UTC(y, 0, 1) - ist), to: new Date(Date.UTC(y + 1, 0, 1) - ist) };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) throw new RangeError(`Bad recap month ${key}`);
  const [y, mo] = [Number(m[1]), Number(m[2]) - 1];
  return { from: new Date(Date.UTC(y, mo, 1) - ist), to: new Date(Date.UTC(y, mo + 1, 1) - ist) };
}

/** The recap key for the period that ended just before `now` (IST). */
export function previousRecapKey(period: RecapPeriod, now: Date): string {
  const shifted = new Date(now.getTime() + 330 * 60_000);
  const y = shifted.getUTCFullYear();
  if (period === 'year') return String(y - 1);
  const m = shifted.getUTCMonth();
  return m === 0 ? `${String(y - 1)}-12` : `${String(y)}-${String(m).padStart(2, '0')}`;
}
