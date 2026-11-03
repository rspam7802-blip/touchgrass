import {
  smallint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { geographyPoint } from '../geography.js';

/**
 * Phase 3 tables. Ownership: venues, saved_venues → `venues`; events, event_* , rsvps, waitlist_offers → `events`.
 * The exact `events.location` of mystery events is only ever selected on the reveal path.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export interface AccessibilityJson {
  stepFree: boolean;
  accessibleRestroom: boolean;
  quietSpace: boolean;
}

export interface RefundPolicyJson {
  kind: 'full' | 'partial' | 'none';
  cutoffHours: number;
  partialPct: number | null;
}

export const venues = pgTable('venues', {
  id: uuid('id').primaryKey(),
  cityId: uuid('city_id').notNull(),
  neighbourhoodId: uuid('neighbourhood_id'),
  name: text('name').notNull(),
  address: text('address').notNull(),
  location: geographyPoint('location').notNull(),
  googlePlaceId: text('google_place_id').unique(),
  indoor: boolean('indoor').notNull().default(false),
  accessibility: jsonb('accessibility').$type<AccessibilityJson>().notNull(),
  isPartner: boolean('is_partner').notNull().default(false),
  description: text('description').notNull().default(''),
  staffPinHash: text('staff_pin_hash'),
  createdByUserId: uuid('created_by_user_id'),
  ...timestamps,
});

export const savedVenues = pgTable(
  'saved_venues',
  { userId: uuid('user_id').notNull(), venueId: uuid('venue_id').notNull(), ...timestamps },
  (t) => [primaryKey({ columns: [t.userId, t.venueId] })],
);

export const events = pgTable('events', {
  id: uuid('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  type: text('type', { enum: ['curated', 'plan', 'crew_session'] }).notNull(),
  status: text('status', { enum: ['draft', 'published', 'cancelled', 'completed'] }).notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  coverMediaId: uuid('cover_media_id'),
  categoryInterestId: uuid('category_interest_id'),
  cityId: uuid('city_id').notNull(),
  neighbourhoodId: uuid('neighbourhood_id'),
  venueId: uuid('venue_id'),
  location: geographyPoint('location').notNull(),
  address: text('address').notNull(),
  placeName: text('place_name'),
  approxCenter: geographyPoint('approx_center').notNull(),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  capacity: integer('capacity').notNull(),
  minGroupSize: integer('min_group_size').notNull().default(2),
  pricePaise: integer('price_paise').notNull().default(0),
  refundPolicy: jsonb('refund_policy').$type<RefundPolicyJson>(),
  visibility: text('visibility', {
    enum: ['public', 'friends_of_friends', 'invite_only', 'women_only', 'balanced'],
  }).notNull(),
  balancedMaxSharePct: integer('balanced_max_share_pct'),
  soloFriendly: boolean('solo_friendly').notNull().default(false),
  smallGroup: boolean('small_group').notNull().default(false),
  mystery: boolean('mystery').notNull().default(false),
  mysteryRevealMinutesBefore: integer('mystery_reveal_minutes_before').notNull().default(120),
  allowPlusOnes: boolean('allow_plus_ones').notNull().default(false),
  indoor: boolean('indoor').notNull().default(false),
  accessibility: jsonb('accessibility').$type<AccessibilityJson>().notNull(),
  creatorUserId: uuid('creator_user_id').notNull(),
  cancelledReason: text('cancelled_reason'),
  cancelledAt: ts('cancelled_at'),
  completedAt: ts('completed_at'),
  publishedAt: ts('published_at'),
  heldAt: ts('held_at'),
  /** Pinned to the top of the city's feed until then (curators, F-GRW-03). */
  featuredUntil: ts('featured_until'),
  featuredRank: smallint('featured_rank'),
  featuredBy: uuid('featured_by'),
  ...timestamps,
});

export const eventInterests = pgTable(
  'event_interests',
  { eventId: uuid('event_id').notNull(), interestId: uuid('interest_id').notNull(), ...timestamps },
  (t) => [primaryKey({ columns: [t.eventId, t.interestId] })],
);

export const eventVibeTags = pgTable(
  'event_vibe_tags',
  { eventId: uuid('event_id').notNull(), vibeTagId: uuid('vibe_tag_id').notNull(), ...timestamps },
  (t) => [primaryKey({ columns: [t.eventId, t.vibeTagId] })],
);

export const eventHosts = pgTable(
  'event_hosts',
  {
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: text('role', { enum: ['host', 'co_host', 'welcome_host'] }).notNull(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);

export const eventInvites = pgTable('event_invites', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id').notNull(),
  inviteeUserId: uuid('invitee_user_id'),
  invitedBy: uuid('invited_by').notNull(),
  linkTokenHash: text('link_token_hash').unique(),
  expiresAt: ts('expires_at'),
  ...timestamps,
});

export const rsvps = pgTable(
  'rsvps',
  {
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    status: text('status', {
      enum: ['going', 'interested', 'waitlisted', 'cancelled', 'checked_in', 'held'],
    }).notNull(),
    genderBucket: text('gender_bucket', { enum: ['woman', 'man', 'other'] })
      .notNull()
      .default('other'),
    plusOneOf: uuid('plus_one_of'),
    guestSeats: integer('guest_seats').notNull().default(0),
    guestClaimTokenHash: text('guest_claim_token_hash').unique(),
    waitlistedAt: ts('waitlisted_at'),
    checkedInAt: ts('checked_in_at'),
    checkInMethod: text('check_in_method', { enum: ['qr', 'geofence'] }),
    cancelledAt: ts('cancelled_at'),
    lateCancel: boolean('late_cancel').notNull().default(false),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);

export const waitlistOffers = pgTable('waitlist_offers', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id').notNull(),
  userId: uuid('user_id').notNull(),
  mode: text('mode', { enum: ['sequential', 'broadcast'] }).notNull(),
  status: text('status', { enum: ['open', 'claimed', 'expired', 'superseded'] }).notNull(),
  expiresAt: ts('expires_at').notNull(),
  ...timestamps,
});
