import { pgTable, pgView, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Phase 2 tables. Ownership: social graph (friendships, blocks, contact_hashes, suggestion_dismissals,
 * squad_edges view) → `social/graph`; reports → `social/reports`; activity_events → `social/activity`.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export const contactHashes = pgTable(
  'contact_hashes',
  { userId: uuid('user_id').notNull(), phoneHash: text('phone_hash').notNull(), ...timestamps },
  (t) => [primaryKey({ columns: [t.userId, t.phoneHash] })],
);

export const friendships = pgTable(
  'friendships',
  {
    userLow: uuid('user_low').notNull(),
    userHigh: uuid('user_high').notNull(),
    requesterId: uuid('requester_id').notNull(),
    status: text('status', { enum: ['pending', 'accepted', 'declined', 'cancelled'] }).notNull(),
    respondedAt: ts('responded_at'),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userLow, t.userHigh] })],
);

export const squadEdges = pgView('squad_edges', {
  userId: uuid('user_id').notNull(),
  friendId: uuid('friend_id').notNull(),
  since: ts('since').notNull(),
}).existing();

export const blocks = pgTable(
  'blocks',
  {
    blockerId: uuid('blocker_id').notNull(),
    blockedId: uuid('blocked_id').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })],
);

export const suggestionDismissals = pgTable(
  'suggestion_dismissals',
  {
    userId: uuid('user_id').notNull(),
    dismissedUserId: uuid('dismissed_user_id').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.dismissedUserId] })],
);

export const reports = pgTable('reports', {
  id: uuid('id').primaryKey(),
  reporterId: uuid('reporter_id'),
  targetType: text('target_type', { enum: ['user', 'event', 'message', 'lore_media'] }).notNull(),
  targetId: uuid('target_id').notNull(),
  category: text('category').notNull(),
  details: text('details').notNull().default(''),
  screenshotMediaIds: uuid('screenshot_media_ids').array().notNull().default([]),
  severity: text('severity', { enum: ['low', 'medium', 'high', 'critical'] }).notNull(),
  cityId: uuid('city_id'),
  ...timestamps,
});

export const activityEvents = pgTable('activity_events', {
  id: uuid('id').primaryKey(),
  actorId: uuid('actor_id').notNull(),
  verb: text('verb', {
    enum: ['joined', 'squad_joined', 'pulled_up', 'plotted', 'badge_earned', 'lore_posted'],
  }).notNull(),
  subjectUserId: uuid('subject_user_id'),
  objectType: text('object_type'),
  objectId: uuid('object_id'),
  sourceEventId: uuid('source_event_id').notNull(),
  cityId: uuid('city_id'),
  ...timestamps,
});
