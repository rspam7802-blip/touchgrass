import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Phase 10 tables. Owners: notifications, notification settings, pending pushes → `notifications`;
 * reminder log → `reminders`; calendar feeds → `calendar`.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });

export type NotificationParamsJson = Record<string, unknown>;

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  kind: text('kind').notNull(),
  category: text('category').notNull(),
  params: jsonb('params').$type<NotificationParamsJson>().notNull().default({}),
  path: text('path').notNull(),
  readAt: ts('read_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const notificationSettings = pgTable('notification_settings', {
  userId: uuid('user_id').primaryKey(),
  quietEnabled: boolean('quiet_enabled').notNull().default(true),
  quietStart: smallint('quiet_start').notNull().default(1320),
  quietEnd: smallint('quiet_end').notNull().default(480),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const pendingPushes = pgTable('pending_pushes', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  notificationId: uuid('notification_id'),
  kind: text('kind').notNull(),
  category: text('category').notNull(),
  params: jsonb('params').$type<NotificationParamsJson>().notNull().default({}),
  path: text('path').notNull(),
  collapseKey: text('collapse_key'),
  deliverAfter: ts('deliver_after').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const reminderLog = pgTable(
  'reminder_log',
  {
    userId: uuid('user_id').notNull(),
    refId: uuid('ref_id').notNull(),
    kind: text('kind').notNull(),
    sentAt: ts('sent_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.refId, t.kind] })],
);

export const calendarFeeds = pgTable('calendar_feeds', {
  userId: uuid('user_id').primaryKey(),
  version: integer('version').notNull().default(1),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
