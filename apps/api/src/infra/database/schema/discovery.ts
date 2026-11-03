import { integer, primaryKey, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Phase 4 tables (owner: `discovery`). Both are monthly range partitions on their timestamp. */
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const discoveryImpressions = pgTable(
  'discovery_impressions',
  {
    id: uuid('id').notNull(),
    requestId: uuid('request_id').notNull(),
    userId: uuid('user_id').notNull(),
    eventId: uuid('event_id').notNull(),
    position: integer('position').notNull(),
    score: real('score').notNull(),
    reasons: text('reasons').array().notNull(),
    servedAt: ts('served_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.servedAt, t.id] })],
);

export const discoveryClicks = pgTable(
  'discovery_clicks',
  {
    id: uuid('id').notNull(),
    requestId: uuid('request_id').notNull(),
    userId: uuid('user_id').notNull(),
    eventId: uuid('event_id').notNull(),
    position: integer('position').notNull(),
    clickedAt: ts('clicked_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clickedAt, t.id] })],
);
