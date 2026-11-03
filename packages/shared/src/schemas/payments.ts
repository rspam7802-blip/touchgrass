import { z } from 'zod';
import { LIMITS } from '../constants';
import { type Paise, percentOfPaise } from '../money';
import { PersonCard } from './social';

const P = LIMITS.payments;
const Paise = z.number().int().min(0);

// ---------- refund policy (F-PAY-02) ----------

/**
 * Attendee cancellations: `full` refunds everything, `partial` refunds `partialPct`%, `none` refunds nothing.
 * Refunds apply only when cancelling at least `cutoffHours` before the start. Host cancellations always refund
 * in full whatever the policy.
 */
export const RefundPolicy = z
  .object({
    kind: z.enum(['full', 'partial', 'none']),
    cutoffHours: z.number().int().min(0).max(P.maxRefundCutoffHours),
    partialPct: z.number().int().min(1).max(99).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'partial' && v.partialPct === null)
      ctx.addIssue({ code: 'custom', path: ['partialPct'], message: 'Partial refunds need a %' });
  });
export type RefundPolicy = z.infer<typeof RefundPolicy>;
export const DEFAULT_REFUND_POLICY: RefundPolicy = {
  kind: 'full',
  cutoffHours: 24,
  partialPct: null,
};

export type RefundReason =
  'HOST_CANCELLED' | 'BEFORE_CUTOFF' | 'AFTER_CUTOFF' | 'NO_REFUNDS' | 'HOLD_EXPIRED';

/** How much an attendee gets back for a cancellation at `now` (pure; the API and the app share it). */
export function refundFor(
  policy: RefundPolicy,
  paidPaise: Paise,
  startsAt: Date,
  now: Date,
): { refundPaise: Paise; reason: RefundReason } {
  if (policy.kind === 'none') return { refundPaise: 0, reason: 'NO_REFUNDS' };
  const cutoff = startsAt.getTime() - policy.cutoffHours * 3_600_000;
  if (now.getTime() > cutoff) return { refundPaise: 0, reason: 'AFTER_CUTOFF' };
  const refundPaise =
    policy.kind === 'full' ? paidPaise : percentOfPaise(paidPaise, (policy.partialPct ?? 0) * 100);
  return { refundPaise, reason: 'BEFORE_CUTOFF' };
}

// ---------- platform fee and GST (F-PAY-03) ----------

export interface FeeBreakdown {
  grossPaise: Paise;
  platformFeePaise: Paise;
  /** GST charged on the platform fee (our service), not on the ticket. */
  gstPaise: Paise;
  hostNetPaise: Paise;
}

/** Splits money kept from ticket sales (gross minus refunds) into fee, GST on the fee, and the host's share. */
export function feeBreakdown(
  grossPaise: Paise,
  feeBps: number,
  gstBps: number = P.gstBps,
): FeeBreakdown {
  const platformFeePaise = percentOfPaise(grossPaise, feeBps);
  const gstPaise = percentOfPaise(platformFeePaise, gstBps);
  return {
    grossPaise,
    platformFeePaise,
    gstPaise,
    hostNetPaise: Math.max(0, grossPaise - platformFeePaise - gstPaise),
  };
}

// ---------- checkout and payments (F-PAY-01) ----------

export const PaymentStatus = z.enum([
  'created',
  'captured',
  'failed',
  'expired',
  'refunded',
  'partially_refunded',
]);
export type PaymentStatus = z.infer<typeof PaymentStatus>;

export const CheckoutBody = z.object({
  /** Where to email the receipt; saved for next time. */
  receiptEmail: z.email().max(254).nullable().default(null),
  /** Claim an open waitlist offer instead of a fresh spot. */
  fromOffer: z.boolean().default(false),
  /** Spend a free-entry credit (referral reward, F-GRW-01) instead of paying. */
  useCredit: z.boolean().default(false),
});
export type CheckoutBody = z.infer<typeof CheckoutBody>;

export const CheckoutSession = z.object({
  paymentId: z.uuid(),
  status: PaymentStatus,
  amountPaise: Paise,
  holdExpiresAt: z.iso.datetime(),
  /** Web checkout page (Razorpay Checkout, UPI first) opened in the in-app browser. */
  checkoutUrl: z.url(),
});
export type CheckoutSession = z.infer<typeof CheckoutSession>;

export const CheckoutResult = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('checkout'), session: CheckoutSession }),
  z.object({ kind: z.literal('waitlisted') }),
  /** Covered by a free-entry credit: the seat is confirmed straight away, nothing to pay. */
  z.object({ kind: z.literal('confirmed'), paymentId: z.uuid() }),
]);
export type CheckoutResult = z.infer<typeof CheckoutResult>;

export const RefundView = z.object({
  id: z.uuid(),
  amountPaise: Paise,
  status: z.enum(['pending', 'processing', 'processed', 'failed']),
  reason: z.string(),
  createdAt: z.iso.datetime(),
  processedAt: z.iso.datetime().nullable(),
});
export type RefundView = z.infer<typeof RefundView>;

export const PaymentView = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  eventTitle: z.string(),
  eventStartsAt: z.iso.datetime(),
  status: PaymentStatus,
  amountPaise: Paise,
  refundedPaise: Paise,
  holdExpiresAt: z.iso.datetime(),
  capturedAt: z.iso.datetime().nullable(),
  receiptNumber: z.string().nullable(),
  refunds: z.array(RefundView),
  createdAt: z.iso.datetime(),
});
export type PaymentView = z.infer<typeof PaymentView>;
export const PaymentList = z.object({
  items: z.array(PaymentView),
  nextCursor: z.string().nullable(),
});
export type PaymentList = z.infer<typeof PaymentList>;

export const Receipt = z.object({
  number: z.string(),
  paymentId: z.uuid(),
  issuedAt: z.iso.datetime(),
  buyerName: z.string(),
  event: z.object({ id: z.uuid(), title: z.string(), startsAt: z.iso.datetime() }),
  hostName: z.string(),
  amountPaise: Paise,
  method: z.string().nullable(),
  /** Platform fee and GST are included in the price (shown for transparency). */
  platformFeePaise: Paise,
  gstPaise: Paise,
  refunds: z.array(RefundView),
  netPaidPaise: Paise,
  sellerName: z.string(),
  sellerGstin: z.string().nullable(),
});
export type Receipt = z.infer<typeof Receipt>;

export const RefundQuote = z.object({
  paidPaise: Paise,
  refundPaise: Paise,
  reason: z.enum(['HOST_CANCELLED', 'BEFORE_CUTOFF', 'AFTER_CUTOFF', 'NO_REFUNDS', 'HOLD_EXPIRED']),
  policy: RefundPolicy,
});
export type RefundQuote = z.infer<typeof RefundQuote>;

/** What the public web checkout page needs (looked up by its unguessable token). */
export const CheckoutPage = z.object({
  paymentId: z.uuid(),
  status: PaymentStatus,
  eventTitle: z.string(),
  eventStartsAt: z.iso.datetime(),
  amountPaise: Paise,
  holdExpiresAt: z.iso.datetime(),
  providerOrderId: z.string(),
  keyId: z.string(),
  /** Development only: the fake gateway lets the page simulate the bank's answer. */
  simulate: z.boolean(),
  returnUrl: z.string(),
});
export type CheckoutPage = z.infer<typeof CheckoutPage>;
export const SimulateCheckoutBody = z.object({ outcome: z.enum(['success', 'failure']) });
export type SimulateCheckoutBody = z.infer<typeof SimulateCheckoutBody>;

export const ReceiptEmailBody = z.object({ email: z.email().max(254).nullable() });
export type ReceiptEmailBody = z.infer<typeof ReceiptEmailBody>;

// ---------- hosting (F-HST-01) and host accounts / payouts (F-PAY-03) ----------

export const HostApplicationStatus = z.enum(['pending', 'approved', 'rejected']);
export const HostApplication = z.object({
  id: z.uuid(),
  status: HostApplicationStatus,
  about: z.string(),
  experience: z.string(),
  eventIdeas: z.string(),
  links: z.array(z.string()),
  reviewNote: z.string().nullable(),
  createdAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
});
export type HostApplication = z.infer<typeof HostApplication>;
export const CreateHostApplicationBody = z.object({
  about: z.string().trim().min(20).max(1000),
  experience: z.string().trim().min(20).max(1000),
  eventIdeas: z.string().trim().min(20).max(1000),
  links: z.array(z.url().max(300)).max(5).default([]),
});
export type CreateHostApplicationBody = z.infer<typeof CreateHostApplicationBody>;

export const HostAccount = z.object({
  status: z.enum(['created', 'activated', 'needs_clarification', 'rejected']),
  legalBusinessName: z.string(),
  contactName: z.string(),
  email: z.string(),
  createdAt: z.iso.datetime(),
  activatedAt: z.iso.datetime().nullable(),
});
export type HostAccount = z.infer<typeof HostAccount>;
export const CreateHostAccountBody = z.object({
  legalBusinessName: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(80),
  email: z.email().max(254),
});
export type CreateHostAccountBody = z.infer<typeof CreateHostAccountBody>;

export const HostStatus = z.object({
  /** Verified people host free plans (F-HST-01). */
  canHostFree: z.boolean(),
  /** Paid plans need an approved application. */
  canHostPaid: z.boolean(),
  application: HostApplication.nullable(),
  account: HostAccount.nullable(),
  platformFeeBps: z.number().int(),
  gstBps: z.number().int(),
});
export type HostStatus = z.infer<typeof HostStatus>;

export const PayoutStatus = z.enum(['pending', 'on_hold', 'processing', 'paid', 'failed']);
export type PayoutStatus = z.infer<typeof PayoutStatus>;
export const PayoutView = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  eventTitle: z.string(),
  status: PayoutStatus,
  grossPaise: Paise,
  refundsPaise: Paise,
  platformFeePaise: Paise,
  gstPaise: Paise,
  netPaise: Paise,
  /** Why it is on hold or failed (stable code). */
  holdReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
});
export type PayoutView = z.infer<typeof PayoutView>;
export const PayoutLedger = z.object({
  items: z.array(PayoutView),
  nextCursor: z.string().nullable(),
  totals: z.object({ paidPaise: Paise, pendingPaise: Paise }),
});
export type PayoutLedger = z.infer<typeof PayoutLedger>;

// ---------- host analytics (F-HST-02) ----------

export const EventAnalytics = z.object({
  eventId: z.uuid(),
  title: z.string(),
  startsAt: z.iso.datetime(),
  status: z.string(),
  /** Distinct people who opened the plan, counted once per day. */
  views: z.number().int(),
  rsvps: z.number().int(),
  /** RSVPs per 100 views, 0 when nobody viewed yet. */
  conversionPct: z.number(),
  checkIns: z.number().int(),
  noShows: z.number().int(),
  repeatAttendees: z.number().int(),
  averageRating: z.number().nullable(),
  ratingsCount: z.number().int(),
  themes: z.array(z.object({ theme: z.string(), count: z.number().int() })),
  revenuePaise: Paise,
});
export type EventAnalytics = z.infer<typeof EventAnalytics>;
export const HostAnalytics = z.object({
  totals: EventAnalytics.omit({ eventId: true, title: true, startsAt: true, status: true }).extend({
    events: z.number().int(),
  }),
  events: z.array(EventAnalytics),
});
export type HostAnalytics = z.infer<typeof HostAnalytics>;

// ---------- venue partnerships and perks (F-PAY-04) ----------

export const VenuePerk = z.object({
  id: z.uuid(),
  venueId: z.uuid(),
  title: z.string(),
  description: z.string(),
  minGroupSize: z.number().int(),
  validUntil: z.iso.datetime().nullable(),
  active: z.boolean(),
});
export type VenuePerk = z.infer<typeof VenuePerk>;
export const EventPerk = z.object({
  perk: VenuePerk,
  venueName: z.string(),
  /** Whether the viewer can redeem now (holds a seat, group big enough, on the day). */
  canRedeem: z.boolean(),
  reason: z.string().nullable(),
  redeemedAt: z.iso.datetime().nullable(),
});
export type EventPerk = z.infer<typeof EventPerk>;
export const EventPerkList = z.object({ items: z.array(EventPerk) });
export type EventPerkList = z.infer<typeof EventPerkList>;

export const PerkPass = z.object({
  /** Short code staff can type. */
  code: z.string(),
  /** Payload for the QR code: the public redemption URL. */
  qr: z.string(),
  perkTitle: z.string(),
  venueName: z.string(),
  expiresAt: z.iso.datetime(),
  redeemedAt: z.iso.datetime().nullable(),
});
export type PerkPass = z.infer<typeof PerkPass>;

export const PerkPassPreview = z.object({
  perkTitle: z.string(),
  perkDescription: z.string(),
  venueName: z.string(),
  eventTitle: z.string(),
  firstName: z.string(),
  groupSize: z.number().int(),
  expiresAt: z.iso.datetime(),
  redeemedAt: z.iso.datetime().nullable(),
});
export type PerkPassPreview = z.infer<typeof PerkPassPreview>;

export const RedeemPerkBody = z
  .object({
    token: z.string().min(20).max(200).optional(),
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z2-9]{6}$/)
      .optional(),
    venueId: z.uuid().optional(),
    pin: z.string().regex(/^\d{4,8}$/),
  })
  .refine((v) => v.token !== undefined || (v.code !== undefined && v.venueId !== undefined), {
    message: 'Scan the QR code or type the code',
  });
export type RedeemPerkBody = z.infer<typeof RedeemPerkBody>;

// ---------- admin (F-WEB-03) ----------

export const AdminHostApplication = HostApplication.extend({ applicant: PersonCard });
export type AdminHostApplication = z.infer<typeof AdminHostApplication>;
export const AdminHostApplicationList = z.object({
  items: z.array(AdminHostApplication),
  nextCursor: z.string().nullable(),
});
export const AdminHostApplicationQuery = z.object({
  status: HostApplicationStatus.default('pending'),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminHostApplicationQuery = z.infer<typeof AdminHostApplicationQuery>;
export const ReviewHostApplicationBody = z.object({
  decision: z.enum(['approved', 'rejected']),
  note: z.string().trim().max(500).default(''),
});
export type ReviewHostApplicationBody = z.infer<typeof ReviewHostApplicationBody>;

export const AdminVenue = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string(),
  neighbourhoodName: z.string().nullable(),
  isPartner: z.boolean(),
  description: z.string(),
  hasStaffPin: z.boolean(),
  perks: z.array(VenuePerk),
  redemptions: z.number().int(),
});
export type AdminVenue = z.infer<typeof AdminVenue>;
export const AdminVenueList = z.object({
  items: z.array(AdminVenue),
  nextCursor: z.string().nullable(),
});
export const AdminVenueQuery = z.object({
  q: z.string().trim().max(80).optional(),
  partner: z.enum(['all', 'partners']).default('all'),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type AdminVenueQuery = z.infer<typeof AdminVenueQuery>;
export const UpdateVenuePartnerBody = z.object({
  isPartner: z.boolean(),
  description: z.string().trim().max(500).default(''),
  /** New staff PIN for redeeming perks; omit to keep the current one. */
  staffPin: z
    .string()
    .regex(/^\d{4,8}$/)
    .optional(),
});
export type UpdateVenuePartnerBody = z.infer<typeof UpdateVenuePartnerBody>;
export const UpsertPerkBody = z.object({
  title: z.string().trim().min(3).max(80),
  description: z.string().trim().max(300).default(''),
  minGroupSize: z.number().int().min(1).max(50).default(1),
  validUntil: z.iso.datetime().nullable().default(null),
  active: z.boolean().default(true),
});
export type UpsertPerkBody = z.infer<typeof UpsertPerkBody>;

export const AdminPaymentsOverview = z.object({
  totals: z.object({
    capturedPaise: Paise,
    refundedPaise: Paise,
    platformFeePaise: Paise,
    gstPaise: Paise,
    payoutsPaidPaise: Paise,
    payoutsPendingPaise: Paise,
  }),
  payments: z.array(
    PaymentView.omit({ refunds: true }).extend({
      buyer: PersonCard,
      method: z.string().nullable(),
    }),
  ),
  refunds: z.array(RefundView.extend({ paymentId: z.uuid(), eventTitle: z.string() })),
  payouts: z.array(PayoutView.extend({ host: PersonCard })),
});
export type AdminPaymentsOverview = z.infer<typeof AdminPaymentsOverview>;
