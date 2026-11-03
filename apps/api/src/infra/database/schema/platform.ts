import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  unique,
} from 'drizzle-orm/pg-core';
import { geographyPoint, geographyPolygon } from '../geography.js';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

export const featureFlags = pgTable('feature_flags', {
  id: uuid('id').primaryKey(),
  key: text('key').notNull().unique(),
  enabled: boolean('enabled').notNull(),
  description: text('description').notNull().default(''),
  ...timestamps,
});

export const outboxEvents = pgTable('outbox_events', {
  id: uuid('id').primaryKey(),
  aggregateType: text('aggregate_type').notNull(),
  aggregateId: uuid('aggregate_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: jsonb('payload').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  ...timestamps,
});

export const cities = pgTable('cities', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  centre: geographyPoint('centre').notNull(),
  bounds: geographyPolygon('bounds').notNull(),
  timezone: text('timezone').notNull(),
  launchStatus: text('launch_status', { enum: ['waitlist', 'beta', 'launched'] }).notNull(),
  languages: text('languages').array().notNull(),
  ...timestamps,
});

export const neighbourhoods = pgTable(
  'neighbourhoods',
  {
    id: uuid('id').primaryKey(),
    cityId: uuid('city_id')
      .notNull()
      .references(() => cities.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    centroid: geographyPoint('centroid').notNull(),
    boundary: geographyPolygon('boundary').notNull(),
    ...timestamps,
  },
  (t) => [unique().on(t.cityId, t.slug)],
);
