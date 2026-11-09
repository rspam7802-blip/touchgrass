import {
  date,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Phase 6 tables. Owners: host applications + accounts → `hosting`; payments, refunds, payouts, payout transfers,
 * webhook events → `payments`; event views → `hosting` (analytics); venue perks + redemptions → `venues`.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export const hostApplications = pgTable('host_applications', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull(),
  status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull(),
  about: text('about').notNull(),
  experience: text('experience').notNull(),
  eventIdeas: text('event_ideas').notNull(),
  links: jsonb('links').$type<string[]>().notNull(),
  reviewNote: text('review_note'),
  reviewedByUserId: uuid('reviewed_by_user_id'),
  reviewedAt: ts('reviewed_at'),
  ...timestamps,
});

export const hostAccounts = pgTable('host_accounts', {
  userId: uuid('user_id').primaryKey(),
  providerAccountId: text('provider_account_id').notNull().unique(),
  status: text('status', {
    enum: ['created', 'activated', 'needs_clarification', 'rejected'],
  }).notNull(),
  legalBusinessName: text('legal_business_name').notNull(),
  contactName: text('contact_name').notNull(),
  email: text('email').notNull(),
  activatedAt: ts('activated_at'),
  ...timestamps,
});

export const payments = pgTable('payments', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id').notNull(),
  userId: uuid('user_id'),
  status: text('status', {
    enum: ['created', 'captured', 'failed', 'expired', 'refunded', 'partially_refunded'],
  }).notNull(),
  amountPaise: integer('amount_paise').notNull(),
  refundedPaise: integer('refunded_paise').notNull().default(0),
  feeBps: integer('fee_bps').notNull(),
  providerOrderId: text('provider_order_id').unique(),
  providerPaymentId: text('provider_payment_id').unique(),
  method: text('method'),
  checkoutTokenHash: text('checkout_token_hash').notNull().unique(),
  holdExpiresAt: ts('hold_expires_at').notNull(),
  capturedAt: ts('captured_at'),
  receiptNumber: text('receipt_number').unique(),
  receiptEmailedAt: ts('receipt_emailed_at'),
  ticketReleasedAt: ts('ticket_released_at'),
  ...timestamps,
});

export const refunds = pgTable('refunds', {
  id: uuid('id').primaryKey(),
  paymentId: uuid('payment_id').notNull(),
  amountPaise: integer('amount_paise').notNull(),
  reason: text('reason', {
    enum: ['HOST_CANCELLED', 'BEFORE_CUTOFF', 'HOLD_EXPIRED', 'DUPLICATE', 'ADMIN'],
  }).notNull(),
  status: text('status', { enum: ['pending', 'processing', 'processed', 'failed'] }).notNull(),
  providerRefundId: text('provider_refund_id').unique(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  processedAt: ts('processed_at'),
  ...timestamps,
});

export const payouts = pgTable('payouts', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id').notNull().unique(),
  hostUserId: uuid('host_user_id').notNull(),
  status: text('status', {
    enum: ['pending', 'on_hold', 'processing', 'paid', 'failed'],
  }).notNull(),
  holdReason: text('hold_reason'),
  grossPaise: integer('gross_paise').notNull(),
  refundsPaise: integer('refunds_paise').notNull(),
  platformFeePaise: integer('platform_fee_paise').notNull(),
  gstPaise: integer('gst_paise').notNull(),
  netPaise: integer('net_paise').notNull(),
  attempts: integer('attempts').notNull().default(0),
  paidAt: ts('paid_at'),
  ...timestamps,
});

export const payoutTransfers = pgTable('payout_transfers', {
  id: uuid('id').primaryKey(),
  payoutId: uuid('payout_id').notNull(),
  paymentId: uuid('payment_id').notNull().unique(),
  amountPaise: integer('amount_paise').notNull(),
  status: text('status', { enum: ['pending', 'processing', 'processed', 'failed'] }).notNull(),
  providerTransferId: text('provider_transfer_id').unique(),
  ...timestamps,
});

export const paymentWebhookEvents = pgTable('payment_webhook_events', {
  providerEventId: text('provider_event_id').primaryKey(),
  type: text('type').notNull(),
  body: jsonb('body').$type<unknown>().notNull(),
  status: text('status', { enum: ['received', 'processed', 'ignored', 'failed'] }).notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  processedAt: ts('processed_at'),
  ...timestamps,
});

export const eventViews = pgTable(
  'event_views',
  {
    eventId: uuid('event_id').notNull(),
    viewerId: uuid('viewer_id').notNull(),
    day: date('day').notNull(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.day, t.viewerId] })],
);

export const venuePerks = pgTable('venue_perks', {
  id: uuid('id').primaryKey(),
  venueId: uuid('venue_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  minGroupSize: integer('min_group_size').notNull().default(1),
  validUntil: ts('valid_until'),
  active: boolean('active').notNull().default(true),
  ...timestamps,
});

export const perkRedemptions = pgTable('perk_redemptions', {
  id: uuid('id').primaryKey(),
  perkId: uuid('perk_id').notNull(),
  eventId: uuid('event_id').notNull(),
  userId: uuid('user_id'),
  code: text('code').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  groupSize: integer('group_size').notNull(),
  expiresAt: ts('expires_at').notNull(),
  redeemedAt: ts('redeemed_at'),
  method: text('method', { enum: ['qr', 'code'] }),
  ...timestamps,
});
