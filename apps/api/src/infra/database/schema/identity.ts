import {
  boolean,
  customType,
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { cities, neighbourhoods } from './platform.js';

/**
 * Phase 1 tables. Ownership (only the owning module reads/writes these):
 *   auth → users (identity columns), user_sessions, refresh_tokens, otp_requests, user_roles
 *   invites → invite_codes, invite_redemptions
 *   profiles → profiles, profile_photos, user_interests, user_vibe_tags
 *   interests (catalog) → interests, vibe_tags
 *   media → media_assets          moderation → moderation_items        admin → admin_actions, app_settings
 *   users (settings/account) → consents, notification_preferences, devices
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};
const inet = customType<{ data: string }>({ dataType: () => 'inet' });
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  phoneE164: text('phone_e164').unique(),
  phoneHash: text('phone_hash').unique(),
  status: text('status', {
    enum: [
      'onboarding',
      'active',
      'age_blocked',
      'suspended',
      'banned',
      'deletion_pending',
      'deleted',
    ],
  }).notNull(),
  language: text('language', { enum: ['en', 'te', 'hi'] }).notNull(),
  cityId: uuid('city_id').references(() => cities.id),
  invitedByUserId: uuid('invited_by_user_id'),
  inviteQuotaOverride: integer('invite_quota_override'),
  verifiedAt: ts('verified_at'),
  receiptEmail: text('receipt_email'),
  deletionRequestedAt: ts('deletion_requested_at'),
  deletedAt: ts('deleted_at'),
  lastActiveAt: ts('last_active_at'),
  ...timestamps,
});

export const userRoles = pgTable('user_roles', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  role: text('role', {
    enum: ['super_admin', 'admin', 'moderator', 'city_curator', 'support'],
  }).notNull(),
  cityId: uuid('city_id'),
  ...timestamps,
});

export const otpRequests = pgTable('otp_requests', {
  id: uuid('id').primaryKey(),
  phoneE164: text('phone_e164').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: ts('expires_at').notNull(),
  consumedAt: ts('consumed_at'),
  requestIp: inet('request_ip'),
  ...timestamps,
});

export const userSessions = pgTable('user_sessions', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  deviceId: text('device_id').notNull(),
  deviceName: text('device_name').notNull(),
  platform: text('platform', { enum: ['ios', 'android', 'web'] }).notNull(),
  appVersion: text('app_version').notNull(),
  ip: inet('ip'),
  lastUsedAt: ts('last_used_at').notNull().defaultNow(),
  revokedAt: ts('revoked_at'),
  revokedReason: text('revoked_reason'),
  ...timestamps,
});

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey(),
  sessionId: uuid('session_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  rotatedAt: ts('rotated_at'),
  ...timestamps,
});

export const inviteCodes = pgTable('invite_codes', {
  id: uuid('id').primaryKey(),
  code: citext('code').notNull().unique(),
  createdByUserId: uuid('created_by_user_id'),
  source: text('source', { enum: ['user', 'admin'] }).notNull(),
  maxUses: integer('max_uses').notNull(),
  uses: integer('uses').notNull().default(0),
  expiresAt: ts('expires_at'),
  revokedAt: ts('revoked_at'),
  label: text('label'),
  ...timestamps,
});

export const inviteRedemptions = pgTable('invite_redemptions', {
  id: uuid('id').primaryKey(),
  inviteCodeId: uuid('invite_code_id').notNull(),
  userId: uuid('user_id').notNull().unique(),
  ...timestamps,
});

export const interests = pgTable('interests', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: jsonb('name').$type<{ en: string; te: string; hi: string }>().notNull(),
  emoji: text('emoji').notNull(),
  category: text('category').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export const vibeTags = pgTable('vibe_tags', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  name: jsonb('name').$type<{ en: string; te: string; hi: string }>().notNull(),
  emoji: text('emoji').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export const profiles = pgTable('profiles', {
  userId: uuid('user_id').primaryKey(),
  displayName: text('display_name'),
  bio: text('bio').notNull().default(''),
  bioHeldAt: ts('bio_held_at'),
  dateOfBirth: date('date_of_birth'),
  gender: text('gender', { enum: ['woman', 'man', 'non_binary', 'prefer_not_to_say'] }),
  pronouns: text('pronouns'),
  cityId: uuid('city_id').references(() => cities.id),
  neighbourhoodId: uuid('neighbourhood_id').references(() => neighbourhoods.id),
  spokenLanguages: text('spoken_languages').array().notNull().default([]),
  visibility: text('visibility', { enum: ['everyone', 'friends_of_friends', 'squad_only'] })
    .notNull()
    .default('everyone'),
  showFirstTimerBadge: boolean('show_first_timer_badge').notNull().default(true),
  readReceipts: boolean('read_receipts').notNull().default(true),
  showInWhoIsGoing: boolean('show_in_who_is_going').notNull().default(true),
  shareActivity: boolean('share_activity').notNull().default(true),
  discoverableByContacts: boolean('discoverable_by_contacts').notNull().default(true),
  onboardingCompletedAt: ts('onboarding_completed_at'),
  tutorialCompletedAt: ts('tutorial_completed_at'),
  ...timestamps,
});

export const userInterests = pgTable(
  'user_interests',
  { userId: uuid('user_id').notNull(), interestId: uuid('interest_id').notNull(), ...timestamps },
  (t) => [primaryKey({ columns: [t.userId, t.interestId] })],
);

export const userVibeTags = pgTable(
  'user_vibe_tags',
  { userId: uuid('user_id').notNull(), vibeTagId: uuid('vibe_tag_id').notNull(), ...timestamps },
  (t) => [primaryKey({ columns: [t.userId, t.vibeTagId] })],
);

export interface VariantKeys {
  sm: string;
  md: string;
  lg: string;
  /** Video assets only: the re-encoded MP4. sm/md/lg are its poster frame. */
  video?: string;
}

export const mediaAssets = pgTable('media_assets', {
  id: uuid('id').primaryKey(),
  ownerUserId: uuid('owner_user_id'),
  purpose: text('purpose', {
    enum: [
      'profile_photo',
      'event_cover',
      'lore',
      'chat',
      'verification_selfie',
      'report_screenshot',
      'story',
    ],
  }).notNull(),
  originalKey: text('original_key').notNull().unique(),
  contentType: text('content_type').notNull(),
  declaredBytes: integer('declared_bytes').notNull(),
  status: text('status', {
    enum: ['pending_upload', 'processing', 'ready', 'flagged', 'rejected', 'deleted'],
  }).notNull(),
  width: integer('width'),
  height: integer('height'),
  variantKeys: jsonb('variant_keys').$type<VariantKeys>(),
  moderationLabels: jsonb('moderation_labels').$type<{ name: string; confidence: number }[]>(),
  /** Video assets only. */
  durationMs: integer('duration_ms'),
  processedAt: ts('processed_at'),
  deletedAt: ts('deleted_at'),
  ...timestamps,
});

export const profilePhotos = pgTable('profile_photos', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  mediaAssetId: uuid('media_asset_id').notNull().unique(),
  position: integer('position').notNull(),
  ...timestamps,
});

export const consents = pgTable('consents', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  kind: text('kind', {
    enum: [
      'terms',
      'privacy',
      'age_confirmation',
      'notifications',
      'contacts',
      'location',
      'marketing',
    ],
  }).notNull(),
  granted: boolean('granted').notNull(),
  version: text('version').notNull(),
  ...timestamps,
});

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id').notNull(),
    category: text('category').notNull(),
    push: boolean('push').notNull(),
    inApp: boolean('in_app').notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.userId, t.category] })],
);

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  sessionId: uuid('session_id'),
  expoPushToken: text('expo_push_token').notNull().unique(),
  platform: text('platform', { enum: ['ios', 'android', 'web'] }).notNull(),
  disabledAt: ts('disabled_at'),
  ...timestamps,
});

export const moderationItems = pgTable('moderation_items', {
  id: uuid('id').primaryKey(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  source: text('source', { enum: ['auto_image', 'auto_text', 'report'] }).notNull(),
  severity: text('severity', { enum: ['low', 'medium', 'high', 'critical'] }).notNull(),
  status: text('status', { enum: ['open', 'actioned', 'dismissed'] })
    .notNull()
    .default('open'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  cityId: uuid('city_id'),
  resolvedByUserId: uuid('resolved_by_user_id'),
  resolvedAt: ts('resolved_at'),
  ...timestamps,
});

export const adminActions = pgTable('admin_actions', {
  id: uuid('id').primaryKey(),
  adminUserId: uuid('admin_user_id').notNull(),
  action: text('action').notNull(),
  targetType: text('target_type').notNull(),
  targetId: text('target_id'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  ...timestamps,
});

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<number>().notNull(),
  ...timestamps,
});
