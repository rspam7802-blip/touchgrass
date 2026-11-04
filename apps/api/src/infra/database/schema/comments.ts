import { pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Phase 13: comments on plans, owned by the `event-comments` module. */
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const eventComments = pgTable('event_comments', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id').notNull(),
  authorId: uuid('author_id').notNull(),
  body: text('body').notNull(),
  heldAt: ts('held_at'),
  status: text('status', { enum: ['visible', 'removed'] })
    .notNull()
    .default('visible'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
