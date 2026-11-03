import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Phase 8 tables. Owners: availability → `availability`; crews, members, recurrence, sessions → `crews`;
 * proposals, invitees, options, votes → `proposals`; facts, badges, streaks, challenges, recaps →
 * `gamification`; referral codes, referrals, rewards, uses → `referrals`.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export const availabilityStatus = pgTable('availability_status', {
  userId: uuid('user_id').primaryKey(),
  until: ts('until').notNull(),
  note: text('note').notNull().default(''),
  ...timestamps,
});

export const crews = pgTable('crews', {
  id: uuid('id').primaryKey(),
  cityId: uuid('city_id'),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  interestId: uuid('interest_id'),
  coverMediaId: uuid('cover_media_id'),
  joinPolicy: text('join_policy', { enum: ['request', 'invite_only'] })
    .notNull()
    .default('request'),
  createdBy: uuid('created_by'),
  status: text('status', { enum: ['active', 'archived'] })
    .notNull()
    .default('active'),
  heldAt: ts('held_at'),
  ...timestamps,
});

export const crewMembers = pgTable(
  'crew_members',
  {
    crewId: uuid('crew_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role', { enum: ['admin', 'member'] })
      .notNull()
      .default('member'),
    status: text('status', { enum: ['active', 'requested', 'invited'] }).notNull(),
    invitedBy: uuid('invited_by'),
    joinedAt: ts('joined_at'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.crewId, t.userId] })],
);

export const crewRecurrence = pgTable('crew_recurrence', {
  crewId: uuid('crew_id').primaryKey(),
  rrule: text('rrule').notNull(),
  startsAt: ts('starts_at').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  capacity: integer('capacity').notNull(),
  title: text('title').notNull().default(''),
  locationWhere: jsonb('location_where').notNull(),
  placeLabel: text('place_label').notNull(),
  hostUserId: uuid('host_user_id'),
  active: boolean('active').notNull().default(true),
  generatedUntil: ts('generated_until'),
  ...timestamps,
});

export const crewSessions = pgTable(
  'crew_sessions',
  {
    crewId: uuid('crew_id').notNull(),
    occurrenceAt: ts('occurrence_at').notNull(),
    eventId: uuid('event_id').notNull().unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.crewId, t.occurrenceAt] })],
);

export const planProposals = pgTable('plan_proposals', {
  id: uuid('id').primaryKey(),
  creatorId: uuid('creator_id').notNull(),
  cityId: uuid('city_id'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  categoryInterestId: uuid('category_interest_id'),
  status: text('status', { enum: ['open', 'locked', 'cancelled'] })
    .notNull()
    .default('open'),
  deadline: ts('deadline').notNull(),
  autoLock: boolean('auto_lock').notNull().default(true),
  capacity: integer('capacity').notNull(),
  eventId: uuid('event_id'),
  cancelledReason: text('cancelled_reason'),
  lockedAt: ts('locked_at'),
  heldAt: ts('held_at'),
  ...timestamps,
});

export const proposalInvitees = pgTable(
  'proposal_invitees',
  {
    proposalId: uuid('proposal_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.proposalId, t.userId] })],
);

export const proposalOptions = pgTable('proposal_options', {
  id: uuid('id').primaryKey(),
  proposalId: uuid('proposal_id').notNull(),
  kind: text('kind', { enum: ['time', 'place', 'activity'] }).notNull(),
  label: text('label').notNull().default(''),
  startsAt: ts('starts_at'),
  endsAt: ts('ends_at'),
  locationWhere: jsonb('location_where'),
  address: text('address'),
  interestId: uuid('interest_id'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const proposalVotes = pgTable(
  'proposal_votes',
  {
    optionId: uuid('option_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.optionId, t.userId] })],
);

export const gamificationFacts = pgTable(
  'gamification_facts',
  {
    userId: uuid('user_id').notNull(),
    kind: text('kind').notNull(),
    ref: text('ref').notNull(),
    at: ts('at').notNull(),
    attrs: jsonb('attrs').notNull().default({}),
  },
  (t) => [primaryKey({ columns: [t.userId, t.kind, t.ref] })],
);

export const badges = pgTable('badges', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  name: jsonb('name').notNull(),
  description: jsonb('description').notNull(),
  emoji: text('emoji').notNull(),
  rule: jsonb('rule').notNull(),
  active: boolean('active').notNull().default(true),
  builtin: boolean('builtin').notNull().default(false),
  sort: integer('sort').notNull().default(100),
  ...timestamps,
});

export const userBadges = pgTable(
  'user_badges',
  {
    userId: uuid('user_id').notNull(),
    badgeId: uuid('badge_id').notNull(),
    earnedAt: ts('earned_at').notNull().defaultNow(),
    eventId: uuid('event_id'),
  },
  (t) => [primaryKey({ columns: [t.userId, t.badgeId] })],
);

export const streaks = pgTable('streaks', {
  userId: uuid('user_id').primaryKey(),
  current: integer('current').notNull().default(0),
  longest: integer('longest').notNull().default(0),
  remindedWeek: text('reminded_week'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const streakFreezes = pgTable(
  'streak_freezes',
  {
    userId: uuid('user_id').notNull(),
    week: text('week').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.week] })],
);

export const challenges = pgTable('challenges', {
  id: uuid('id').primaryKey(),
  title: jsonb('title').notNull(),
  description: jsonb('description').notNull(),
  emoji: text('emoji').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  mode: text('mode', { enum: ['solo', 'group'] }).notNull(),
  criteria: jsonb('criteria').notNull(),
  rewardBadgeId: uuid('reward_badge_id'),
  active: boolean('active').notNull().default(true),
  createdBy: uuid('created_by'),
  ...timestamps,
});

export const challengeParticipants = pgTable(
  'challenge_participants',
  {
    challengeId: uuid('challenge_id').notNull(),
    userId: uuid('user_id').notNull(),
    crewId: uuid('crew_id'),
    progress: integer('progress').notNull().default(0),
    completedAt: ts('completed_at'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.challengeId, t.userId] })],
);

export const recaps = pgTable('recaps', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  period: text('period', { enum: ['month', 'year'] }).notNull(),
  key: text('key').notNull(),
  stats: jsonb('stats').notNull(),
  notifiedAt: ts('notified_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const referralCodes = pgTable('referral_codes', {
  userId: uuid('user_id').primaryKey(),
  code: text('code').notNull().unique(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const referrals = pgTable('referrals', {
  id: uuid('id').primaryKey(),
  referrerId: uuid('referrer_id'),
  refereeId: uuid('referee_id').unique(),
  code: text('code').notNull(),
  refereePhoneHash: text('referee_phone_hash').notNull(),
  refereeDeviceId: text('referee_device_id'),
  status: text('status', { enum: ['pending', 'rewarded', 'rejected'] })
    .notNull()
    .default('pending'),
  rejectReason: text('reject_reason'),
  rewardedAt: ts('rewarded_at'),
  ...timestamps,
});

export const referralRewards = pgTable('referral_rewards', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  referralId: uuid('referral_id'),
  kind: text('kind', { enum: ['priority_pass', 'credit'] }).notNull(),
  remaining: integer('remaining').notNull(),
  maxPaise: integer('max_paise'),
  ...timestamps,
});

export const referralRewardUses = pgTable('referral_reward_uses', {
  id: uuid('id').primaryKey(),
  rewardId: uuid('reward_id').notNull(),
  userId: uuid('user_id').notNull(),
  eventId: uuid('event_id'),
  paymentId: uuid('payment_id').unique(),
  restoredAt: ts('restored_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
