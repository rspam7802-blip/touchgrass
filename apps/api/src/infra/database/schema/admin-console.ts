import {
  bigint,
  date,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Phase 11 tables. Owners: city_waitlist → `cities`; ranking_weights → `discovery`;
 * notification_template_overrides → `notifications`; analytics_daily / analytics_active → `analytics`.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const cityWaitlist = pgTable('city_waitlist', {
  userId: uuid('user_id').primaryKey(),
  cityId: uuid('city_id'),
  requestedName: text('requested_name'),
  normalizedName: text('normalized_name'),
  notifiedAt: ts('notified_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const rankingWeights = pgTable('ranking_weights', {
  key: text('key').primaryKey(),
  value: numeric('value', { precision: 5, scale: 2, mode: 'number' }).notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const notificationTemplateOverrides = pgTable(
  'notification_template_overrides',
  {
    kind: text('kind').notNull(),
    language: text('language', { enum: ['en', 'te', 'hi'] }).notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.language] })],
);

/** The all-zero uuid stands for "no city" in the analytics read model. */
export const NO_CITY = '00000000-0000-0000-0000-000000000000';

export const analyticsDaily = pgTable(
  'analytics_daily',
  {
    day: date('day').notNull(),
    cityId: uuid('city_id').notNull(),
    metric: text('metric').notNull(),
    value: bigint('value', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.day, t.cityId, t.metric] })],
);

export const analyticsActive = pgTable(
  'analytics_active',
  {
    day: date('day').notNull(),
    userId: uuid('user_id').notNull(),
    cityId: uuid('city_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.day, t.userId] })],
);
