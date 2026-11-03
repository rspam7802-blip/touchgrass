import {
  doublePrecision,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Phase 9 tables. Owners: verifications → `verification`; trusted contacts, live location shares and points →
 * `safety`; user sanctions → `moderation`.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export const verifications = pgTable('verifications', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  pose: text('pose').notNull(),
  status: text('status', {
    enum: ['challenged', 'pending', 'approved', 'rejected', 'expired'],
  })
    .notNull()
    .default('challenged'),
  expiresAt: ts('expires_at').notNull(),
  mediaAssetId: uuid('media_asset_id'),
  faceSimilarity: real('face_similarity'),
  submittedAt: ts('submitted_at'),
  reviewedByUserId: uuid('reviewed_by_user_id'),
  reviewedAt: ts('reviewed_at'),
  rejectReason: text('reject_reason', {
    enum: ['POSE_MISMATCH', 'FACE_MISMATCH', 'UNCLEAR', 'NOT_A_PERSON', 'OTHER'],
  }),
  ...timestamps,
});

export const trustedContacts = pgTable('trusted_contacts', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  name: text('name').notNull(),
  phoneE164: text('phone_e164').notNull(),
  ...timestamps,
});

export const liveLocationShares = pgTable('live_location_shares', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  eventId: uuid('event_id'),
  startedAt: ts('started_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
  endedAt: ts('ended_at'),
  sosAt: ts('sos_at'),
  contactsNotified: integer('contacts_notified').notNull().default(0),
  lastPointAt: ts('last_point_at'),
  ...timestamps,
});

export const liveLocationPoints = pgTable('live_location_points', {
  id: uuid('id').primaryKey(),
  shareId: uuid('share_id').notNull(),
  lat: doublePrecision('lat').notNull(),
  lng: doublePrecision('lng').notNull(),
  accuracy: real('accuracy'),
  recordedAt: ts('recorded_at').notNull().defaultNow(),
});

export const userSanctions = pgTable('user_sanctions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  kind: text('kind', { enum: ['warn', 'mute', 'suspend', 'ban'] }).notNull(),
  reason: text('reason').notNull(),
  until: ts('until'),
  liftedAt: ts('lifted_at'),
  liftedByUserId: uuid('lifted_by_user_id'),
  createdByUserId: uuid('created_by_user_id'),
  moderationItemId: uuid('moderation_item_id'),
  ...timestamps,
});
