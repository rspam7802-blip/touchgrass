import { integer, numeric, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Phase 7 tables. Owners: event feedback + host ratings → `feedback`; reconnect pulls + post-event prompts →
 * `after`; Lore albums + items → `lore`; reliability events + scores → `reliability`.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export const eventFeedback = pgTable(
  'event_feedback',
  {
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    rating: integer('rating').notNull(),
    great: text('great').array().notNull().default([]),
    improve: text('improve').array().notNull().default([]),
    comment: text('comment').notNull().default(''),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);

export const hostRatings = pgTable(
  'host_ratings',
  {
    eventId: uuid('event_id').notNull(),
    raterId: uuid('rater_id').notNull(),
    hostUserId: uuid('host_user_id').notNull(),
    rating: integer('rating').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.eventId, t.raterId] })],
);

export const reconnectPulls = pgTable(
  'reconnect_pulls',
  {
    eventId: uuid('event_id').notNull(),
    fromUserId: uuid('from_user_id').notNull(),
    toUserId: uuid('to_user_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.fromUserId, t.toUserId] })],
);

export const postEventPrompts = pgTable(
  'post_event_prompts',
  {
    userId: uuid('user_id').notNull(),
    eventId: uuid('event_id').notNull(),
    dismissedAt: ts('dismissed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId] })],
);

export const loreAlbums = pgTable('lore_albums', {
  eventId: uuid('event_id').primaryKey(),
  visibility: text('visibility', { enum: ['attendees', 'friends_of_attendees'] })
    .notNull()
    .default('attendees'),
  coverMediaId: uuid('cover_media_id'),
  coverSource: text('cover_source').notNull().default(''),
  ...timestamps,
});

export const loreItems = pgTable('lore_items', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id').notNull(),
  mediaId: uuid('media_id').notNull().unique(),
  uploaderId: uuid('uploader_id'),
  caption: text('caption').notNull().default(''),
  captionHeldAt: ts('caption_held_at'),
  status: text('status', { enum: ['visible', 'removed'] })
    .notNull()
    .default('visible'),
  removedByUserId: uuid('removed_by_user_id'),
  ...timestamps,
});

export const reliabilityEvents = pgTable(
  'reliability_events',
  {
    userId: uuid('user_id').notNull(),
    eventId: uuid('event_id').notNull(),
    kind: text('kind', { enum: ['check_in', 'no_show', 'late_cancel'] }).notNull(),
    at: ts('at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.eventId, t.kind] })],
);

export const reliabilityScores = pgTable('reliability_scores', {
  userId: uuid('user_id').primaryKey(),
  score: numeric('score', { precision: 5, scale: 1, mode: 'number' }).notNull(),
  tier: text('tier', {
    enum: ['new', 'super_reliable', 'reliable', 'hit_or_miss', 'flaky'],
  }).notNull(),
  noShowsRecent: integer('no_shows_recent').notNull().default(0),
  cooldownUntil: ts('cooldown_until'),
  computedAt: ts('computed_at').notNull().defaultNow(),
});
