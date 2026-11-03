import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Phase 13 tables, owned by the `stories` module. */
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const stories = pgTable('stories', {
  id: uuid('id').primaryKey(),
  authorId: uuid('author_id').notNull(),
  mediaId: uuid('media_id').notNull().unique(),
  caption: text('caption').notNull().default(''),
  audience: text('audience', { enum: ['squad', 'squad_fof'] }).notNull(),
  heldAt: ts('held_at'),
  status: text('status', { enum: ['live', 'removed'] })
    .notNull()
    .default('live'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const storyViews = pgTable(
  'story_views',
  {
    storyId: uuid('story_id').notNull(),
    viewerId: uuid('viewer_id').notNull(),
    viewedAt: ts('viewed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.viewerId] })],
);

export const storyLikes = pgTable(
  'story_likes',
  {
    storyId: uuid('story_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.userId] })],
);
