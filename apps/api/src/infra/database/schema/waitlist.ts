import { customType, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/** Phase 13 (D-169). Owner: `waitlist` → launch_waitlist. */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const citext = customType<{ data: string }>({ dataType: () => 'citext' });

export const launchWaitlist = pgTable('launch_waitlist', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  phoneE164: text('phone_e164').unique(),
  email: citext('email').unique(),
  city: text('city').notNull(),
  note: text('note'),
  language: text('language', { enum: ['en', 'te', 'hi'] }).notNull(),
  invitedAt: ts('invited_at'),
  inviteCodeId: uuid('invite_code_id'),
  /** The link's utm_source (D-191), e.g. instagram or whatsapp; null when unknown. */
  source: text('source'),
  /** The member whose referral link brought them, if any. */
  referrerUserId: uuid('referrer_user_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
