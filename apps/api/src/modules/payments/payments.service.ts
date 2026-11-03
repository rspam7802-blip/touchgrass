import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CheckoutBody,
  type CheckoutPage,
  type CheckoutResult,
  type CheckoutSession,
  decodeCursor,
  encodeCursor,
  feeBreakdown,
  LIMITS,
  type PaymentList,
  type PaymentView,
  type Receipt,
  type RefundQuote,
  type RefundView,
  refundFor,
  DEFAULT_REFUND_POLICY,
  TimeIdCursor,
} from '@touchgrass/shared';
import { and, desc, eq, inArray, lt, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { PaymentsGateway } from '../../adapters/payments/payments.port.js';
import { pepperedHash, randomToken } from '../../common/auth/hashing.js';
import { PaymentCredits } from './payment-credits.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { payments, refunds } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import type { ViewerPayment } from '../events/event-hooks.js';
import { EventStore } from '../events/event-store.service.js';
import { RsvpService } from '../events/rsvp.service.js';
import { AppSettingsService } from '../platform/app-settings.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { UsersService } from '../users/users.service.js';

export const PAYMENT_CAPTURED_EVENT = 'payment.captured';
export const REFUND_REQUESTED_EVENT = 'payment.refund_requested';

export type PaymentRow = typeof payments.$inferSelect;
export type RefundRow = typeof refunds.$inferSelect;

const PAID_STATUSES = ['captured', 'partially_refunded', 'refunded'] as const;
const OPEN_STATUSES = ['created', 'failed'] as const;

/** Next receipt number, "TG-<year>-<6 digits>" from a database sequence (gap-free enough for invoices). */
export async function nextReceiptNumber(tx: Tx, now: Date): Promise<string> {
  const seq = await tx.execute<{ n: number }>(sql`SELECT nextval('receipt_number_seq')::int AS n`);
  const n = seq.rows[0]?.n ?? 0;
  return `TG-${String(now.getUTCFullYear())}-${String(n).padStart(6, '0')}`;
}

export function toRefundView(r: RefundRow): RefundView {
  return {
    id: r.id,
    amountPaise: r.amountPaise,
    status: r.status,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    processedAt: r.processedAt?.toISOString() ?? null,
  };
}

/**
 * Ticketing (F-PAY-01) and receipts (F-PAY-05). The client never confirms a payment: a seat is held for ten
 * minutes while the person pays on the checkout page, and only a verified webhook (see `WebhooksService`) turns
 * the hold into a ticket.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly gateway: PaymentsGateway,
    private readonly rsvp: RsvpService,
    private readonly store: EventStore,
    private readonly settings: AppSettingsService,
    private readonly profiles: ProfilesService,
    private readonly users: UsersService,
    private readonly outbox: OutboxService,
    private readonly credits: PaymentCredits,
  ) {}

  private hashToken(token: string): string {
    return pepperedHash(this.env.TOKEN_HASH_PEPPER, `checkout:${token}`);
  }

  private checkoutUrl(token: string): string {
    return `${this.env.WEB_PUBLIC_URL}/pay/${token}`;
  }

  private session(p: PaymentRow, token: string): CheckoutSession {
    return {
      paymentId: p.id,
      status: p.status,
      amountPaise: p.amountPaise,
      holdExpiresAt: p.holdExpiresAt.toISOString(),
      checkoutUrl: this.checkoutUrl(token),
    };
  }

  // ---------- checkout ----------

  async checkout(
    userId: string,
    eventId: string,
    body: CheckoutBody,
    now: Date = new Date(),
  ): Promise<CheckoutResult> {
    if (body.receiptEmail) await this.users.setReceiptEmail(userId, body.receiptEmail);
    if (body.useCredit) return this.checkoutWithCredit(userId, eventId, body, now);
    const token = randomToken();
    const open = await this.openFor(userId, eventId, now);
    if (open?.providerOrderId) {
      // Same order, fresh link (the old token is only stored hashed, so it cannot be shown again).
      const [p] = await this.db
        .update(payments)
        .set({ checkoutTokenHash: this.hashToken(token) })
        .where(and(eq(payments.id, open.id), eq(payments.status, 'created')))
        .returning();
      if (p) return { kind: 'checkout', session: this.session(p, token) };
    }
    const feeBps = await this.settings.get('platform_fee_bps');
    const paymentId = uuidv7();
    const holdExpiresAt = new Date(now.getTime() + LIMITS.payments.holdMs);
    const outcome = await this.rsvp.holdForCheckout(
      userId,
      eventId,
      { fromOffer: body.fromOffer },
      async (tx, locked) => {
        // Any earlier open checkout for this plan is superseded by this one.
        await tx
          .update(payments)
          .set({ status: 'expired' })
          .where(
            and(
              eq(payments.eventId, eventId),
              eq(payments.userId, userId),
              inArray(payments.status, [...OPEN_STATUSES]),
            ),
          );
        await tx.insert(payments).values({
          id: paymentId,
          eventId,
          userId,
          status: 'created',
          amountPaise: locked.pricePaise,
          feeBps,
          checkoutTokenHash: this.hashToken(token),
          holdExpiresAt,
        });
      },
      now,
    );
    if (outcome === 'waitlisted') return { kind: 'waitlisted' };
    const [created] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!created) throw new AppError('INTERNAL', 'Checkout vanished');
    let orderId: string;
    try {
      const order = await this.gateway.createOrder({
        amountPaise: created.amountPaise,
        receipt: paymentId,
        notes: { eventId, paymentId },
      });
      orderId = order.providerOrderId;
    } catch (err) {
      this.logger.error(`Order creation failed for ${paymentId}: ${String(err)}`);
      await this.release(created, 'failed', now);
      throw new AppError(
        'PAYMENT_PROVIDER_ERROR',
        'Payments are having trouble. Nothing was charged.',
      );
    }
    const [p] = await this.db
      .update(payments)
      .set({ providerOrderId: orderId })
      .where(eq(payments.id, paymentId))
      .returning();
    return { kind: 'checkout', session: this.session(p ?? created, token) };
  }

  /**
   * Free entry (F-GRW-01): a credit is spent in the same transaction that holds the seat, then the ticket is
   * confirmed straight away with a receipt (method "credit"). The host is still paid for the seat: the payout
   * sends that share from the platform balance.
   */
  private async checkoutWithCredit(
    userId: string,
    eventId: string,
    body: CheckoutBody,
    now: Date,
  ): Promise<CheckoutResult> {
    const feeBps = await this.settings.get('platform_fee_bps');
    const paymentId = uuidv7();
    const outcome = await this.rsvp.holdForCheckout(
      userId,
      eventId,
      { fromOffer: body.fromOffer },
      async (tx, locked) => {
        await tx
          .update(payments)
          .set({ status: 'expired' })
          .where(
            and(
              eq(payments.eventId, eventId),
              eq(payments.userId, userId),
              inArray(payments.status, [...OPEN_STATUSES]),
            ),
          );
        await tx.insert(payments).values({
          id: paymentId,
          eventId,
          userId,
          status: 'created',
          amountPaise: locked.pricePaise,
          feeBps,
          method: 'credit',
          checkoutTokenHash: this.hashToken(randomToken()),
          holdExpiresAt: new Date(now.getTime() + LIMITS.payments.holdMs),
        });
        // Same transaction: a failed reservation rolls back the payment row and the held seat.
        const reserved = await this.credits.reserve(
          tx,
          userId,
          paymentId,
          eventId,
          locked.pricePaise,
        );
        if (reserved !== 'ok')
          throw new AppError('NOT_ELIGIBLE', 'No free entry for this plan', { reason: reserved });
      },
      now,
    );
    if (outcome === 'waitlisted') return { kind: 'waitlisted' };
    await this.rsvp.confirmPaid(
      eventId,
      userId,
      async (tx, seated) => {
        const [locked] = await tx
          .select()
          .from(payments)
          .where(eq(payments.id, paymentId))
          .for('update');
        if (locked?.status !== 'created') return;
        if (!seated) {
          await this.credits.restore(tx, paymentId);
          await tx.update(payments).set({ status: 'expired' }).where(eq(payments.id, paymentId));
          return;
        }
        const [captured] = await tx
          .update(payments)
          .set({
            status: 'captured',
            capturedAt: now,
            receiptNumber: await nextReceiptNumber(tx, now),
          })
          .where(eq(payments.id, paymentId))
          .returning();
        if (captured) await this.announceCaptured(tx, captured);
      },
      now,
    );
    const [p] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (p?.status !== 'captured')
      throw new AppError('HOLD_EXPIRED', 'The spot was released, try again');
    return { kind: 'confirmed', paymentId };
  }

  /** The person backs out of checkout: the seat goes back now rather than in ten minutes. */
  async cancelCheckout(userId: string, paymentId: string, now: Date = new Date()): Promise<void> {
    const p = await this.ownPayment(userId, paymentId);
    if (!OPEN_STATUSES.includes(p.status as (typeof OPEN_STATUSES)[number])) return;
    await this.release(p, 'expired', now);
  }

  private async openFor(userId: string, eventId: string, now: Date): Promise<PaymentRow | null> {
    const [p] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.eventId, eventId),
          eq(payments.userId, userId),
          eq(payments.status, 'created'),
          sql`${payments.holdExpiresAt} > ${now}`,
        ),
      )
      .limit(1);
    return p ?? null;
  }

  /** Releases the held seat and closes the checkout in one transaction (under the event lock). */
  async release(p: PaymentRow, status: 'expired' | 'failed', now: Date): Promise<void> {
    if (!p.userId) return;
    await this.rsvp.releaseHold(
      p.eventId,
      p.userId,
      async (tx) => {
        await tx
          .update(payments)
          .set({ status })
          .where(and(eq(payments.id, p.id), inArray(payments.status, [...OPEN_STATUSES])));
      },
      now,
    );
  }

  /** Every minute: checkouts past their ten minutes give their seat back (F-PAY-01). */
  async expireHolds(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .select()
      .from(payments)
      .where(and(inArray(payments.status, [...OPEN_STATUSES]), lt(payments.holdExpiresAt, now)))
      .limit(500);
    for (const p of due) await this.release(p, 'expired', now);
    return due.length;
  }

  // ---------- public checkout page (web) ----------

  async checkoutPage(token: string): Promise<CheckoutPage> {
    const p = await this.byToken(token);
    const core = await this.store.core(p.eventId);
    if (!core || !p.providerOrderId) throw AppError.notFound('Checkout');
    return {
      paymentId: p.id,
      status: p.status,
      eventTitle: core.title,
      eventStartsAt: core.startsAt.toISOString(),
      amountPaise: p.amountPaise,
      holdExpiresAt: p.holdExpiresAt.toISOString(),
      providerOrderId: p.providerOrderId,
      keyId: this.gateway.publicKeyId,
      simulate: this.canSimulate(),
      returnUrl: `touchgrass://payments/${p.id}`,
    };
  }

  /** Development checkout with the fake gateway: the page plays the bank. Never in production. */
  canSimulate(): boolean {
    return this.env.PAYMENTS_PROVIDER === 'fake' && this.env.NODE_ENV !== 'production';
  }

  async byToken(token: string): Promise<PaymentRow> {
    const [p] = await this.db
      .select()
      .from(payments)
      .where(eq(payments.checkoutTokenHash, this.hashToken(token)))
      .limit(1);
    if (!p) throw AppError.notFound('Checkout');
    return p;
  }

  // ---------- reading ----------

  private async ownPayment(userId: string, paymentId: string): Promise<PaymentRow> {
    const [p] = await this.db
      .select()
      .from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.userId, userId)))
      .limit(1);
    if (!p) throw AppError.notFound('Payment');
    return p;
  }

  async payment(userId: string, paymentId: string): Promise<PaymentView> {
    const p = await this.ownPayment(userId, paymentId);
    const [view] = await this.views([p]);
    if (!view) throw AppError.notFound('Payment');
    return view;
  }

  async list(userId: string, cursor: string | undefined, limit: number): Promise<PaymentList> {
    const after = cursor ? decodeCursor(cursor, TimeIdCursor) : null;
    const rows = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.userId, userId),
          // Abandoned checkouts are noise in a payment history.
          inArray(payments.status, [...PAID_STATUSES, 'failed']),
          after
            ? or(
                lt(payments.createdAt, new Date(after.t)),
                and(eq(payments.createdAt, new Date(after.t)), lt(payments.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(payments.createdAt), desc(payments.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.views(page),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async views(rows: PaymentRow[]): Promise<PaymentView[]> {
    if (rows.length === 0) return [];
    const [cores, refundRows] = await Promise.all([
      this.store.coresByIds([...new Set(rows.map((r) => r.eventId))]),
      this.db
        .select()
        .from(refunds)
        .where(
          inArray(
            refunds.paymentId,
            rows.map((r) => r.id),
          ),
        )
        .orderBy(refunds.createdAt),
    ]);
    const byId = new Map(cores.map((c) => [c.id, c]));
    return rows.map((p) => {
      const core = byId.get(p.eventId);
      return {
        id: p.id,
        eventId: p.eventId,
        eventTitle: core?.title ?? '',
        eventStartsAt: (core?.startsAt ?? p.createdAt).toISOString(),
        status: p.status,
        amountPaise: p.amountPaise,
        refundedPaise: p.refundedPaise,
        holdExpiresAt: p.holdExpiresAt.toISOString(),
        capturedAt: p.capturedAt?.toISOString() ?? null,
        receiptNumber: p.receiptNumber,
        refunds: refundRows.filter((r) => r.paymentId === p.id).map(toRefundView),
        createdAt: p.createdAt.toISOString(),
      };
    });
  }

  /** Event detail hook: the viewer's open or paid checkout for this plan. */
  async viewerPayment(userId: string, eventId: string): Promise<ViewerPayment | null> {
    const [p] = await this.db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.userId, userId),
          eq(payments.eventId, eventId),
          inArray(payments.status, ['created', 'failed', 'captured', 'partially_refunded']),
        ),
      )
      .orderBy(desc(payments.createdAt))
      .limit(1);
    return p
      ? {
          id: p.id,
          status: p.status,
          holdExpiresAt: p.holdExpiresAt.toISOString(),
          amountPaise: p.amountPaise,
        }
      : null;
  }

  async hasPayments(eventId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(eq(payments.eventId, eventId), inArray(payments.status, ['created', ...PAID_STATUSES])),
      )
      .limit(1);
    return row !== undefined;
  }

  /** Money kept from ticket sales per plan (paid minus refunded), for host analytics (F-HST-02). */
  async revenueByEvent(eventIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>(eventIds.map((id) => [id, 0]));
    if (eventIds.length === 0) return out;
    const rows = await this.db
      .select({
        eventId: payments.eventId,
        n: sql<number>`coalesce(sum(${payments.amountPaise} - ${payments.refundedPaise}), 0)::int`,
      })
      .from(payments)
      .where(and(inArray(payments.eventId, eventIds), inArray(payments.status, [...PAID_STATUSES])))
      .groupBy(payments.eventId);
    for (const r of rows) out.set(r.eventId, r.n);
    return out;
  }

  /** What cancelling now would refund (the app shows it before the person confirms). */
  async refundQuote(userId: string, eventId: string, now: Date = new Date()): Promise<RefundQuote> {
    const core = await this.store.core(eventId);
    if (!core) throw AppError.notFound('Event');
    const policy = core.refundPolicy ?? DEFAULT_REFUND_POLICY;
    const paid = await this.capturedFor(userId, eventId);
    if (!paid) return { paidPaise: 0, refundPaise: 0, reason: 'NO_REFUNDS', policy };
    const remaining = paid.amountPaise - paid.refundedPaise;
    const quote = refundFor(policy, remaining, core.startsAt, now);
    return {
      paidPaise: paid.amountPaise,
      refundPaise: quote.refundPaise,
      reason: quote.reason,
      policy,
    };
  }

  async capturedFor(
    userId: string,
    eventId: string,
    db: Database | Tx = this.db,
  ): Promise<PaymentRow | null> {
    const [p] = await db
      .select()
      .from(payments)
      .where(
        and(
          eq(payments.userId, userId),
          eq(payments.eventId, eventId),
          inArray(payments.status, ['captured', 'partially_refunded']),
        ),
      )
      .orderBy(payments.capturedAt)
      .limit(1);
    return p ?? null;
  }

  // ---------- receipts (F-PAY-05) ----------

  async receipt(userId: string, paymentId: string): Promise<Receipt> {
    const p = await this.ownPayment(userId, paymentId);
    return this.buildReceipt(p);
  }

  async buildReceipt(p: PaymentRow): Promise<Receipt> {
    if (!p.receiptNumber || !p.capturedAt) throw AppError.notFound('Receipt');
    const [core, hosts, refundRows] = await Promise.all([
      this.store.core(p.eventId),
      this.store.hosts(p.eventId),
      this.db.select().from(refunds).where(eq(refunds.paymentId, p.id)).orderBy(refunds.createdAt),
    ]);
    if (!core) throw AppError.notFound('Receipt');
    const hostId = hosts.find((h) => h.role === 'host')?.userId ?? core.creatorUserId;
    const names = await this.profiles.displayNames([hostId, ...(p.userId ? [p.userId] : [])]);
    const breakdown = feeBreakdown(p.amountPaise, p.feeBps);
    const refunded = refundRows
      .filter((r) => r.status === 'processed')
      .reduce((sum, r) => sum + r.amountPaise, 0);
    return {
      number: p.receiptNumber,
      paymentId: p.id,
      issuedAt: p.capturedAt.toISOString(),
      buyerName: (p.userId ? names.get(p.userId) : null) ?? '',
      event: { id: core.id, title: core.title, startsAt: core.startsAt.toISOString() },
      hostName: names.get(hostId) ?? '',
      amountPaise: p.amountPaise,
      method: p.method,
      platformFeePaise: breakdown.platformFeePaise,
      gstPaise: breakdown.gstPaise,
      refunds: refundRows.map(toRefundView),
      netPaidPaise: p.amountPaise - refunded,
      sellerName: this.env.SELLER_LEGAL_NAME,
      sellerGstin: this.env.SELLER_GSTIN ?? null,
    };
  }

  async receiptEmail(userId: string): Promise<string | null> {
    return (await this.users.findById(userId))?.receiptEmail ?? null;
  }

  async setReceiptEmail(userId: string, email: string | null): Promise<void> {
    await this.users.setReceiptEmail(userId, email);
  }

  /** Outbox event so the worker emails the receipt (idempotent there). */
  async announceCaptured(tx: Tx, p: PaymentRow): Promise<void> {
    await this.outbox.add(tx, {
      aggregateType: 'payment',
      aggregateId: p.id,
      type: PAYMENT_CAPTURED_EVENT,
      payload: {
        paymentId: p.id,
        eventId: p.eventId,
        userId: p.userId,
        amountPaise: p.amountPaise,
      },
    });
  }

  // ---------- account data (DPDP) ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(payments).where(eq(payments.userId, userId));
    return {
      payments: await this.views(rows),
      receiptEmail: await this.receiptEmail(userId),
    };
  }

  /** Payment records are kept for tax law, detached from the person. */
  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.update(payments).set({ userId: null }).where(eq(payments.userId, userId));
    await this.users.setReceiptEmail(userId, null, tx);
  }
}
