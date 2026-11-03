import { Inject, Injectable, Logger } from '@nestjs/common';
import { DEFAULT_REFUND_POLICY, refundFor } from '@touchgrass/shared';
import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { PaymentsGateway } from '../../adapters/payments/payments.port.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { payments, refunds } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { PaymentCredits } from './payment-credits.js';
import { EventStore } from '../events/event-store.service.js';
import {
  type PaymentRow,
  PaymentsService,
  REFUND_REQUESTED_EVENT,
  type RefundRow,
} from './payments.service.js';

export const MAX_REFUND_ATTEMPTS = 5;
const RETRY_AFTER_MS = 60_000;

type RefundReason = RefundRow['reason'];

/**
 * Refunds (F-PAY-02). A refund row is written in the same transaction as the decision (cancel, duplicate,
 * lapsed hold), then sent to the gateway by the worker; only the `refund.processed` webhook marks money as
 * returned. Failed sends are retried with backoff and show up in the admin overview.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly gateway: PaymentsGateway,
    private readonly payments: PaymentsService,
    private readonly store: EventStore,
    private readonly outbox: OutboxService,
    private readonly credits: PaymentCredits,
  ) {}

  /** Money already refunded or on its way back for a payment. */
  private async committed(paymentId: string, db: Database | Tx): Promise<number> {
    const [row] = await db
      .select({ n: sql<number>`coalesce(sum(${refunds.amountPaise}), 0)::int` })
      .from(refunds)
      .where(and(eq(refunds.paymentId, paymentId), ne(refunds.status, 'failed')));
    return row?.n ?? 0;
  }

  /** Records a refund of up to `amountPaise` (never more than what is left) and schedules sending it. */
  async request(
    tx: Tx,
    payment: PaymentRow,
    amountPaise: number,
    reason: RefundReason,
  ): Promise<string | null> {
    // Serialise concurrent decisions about the same payment.
    await tx.execute(sql`SELECT id FROM payments WHERE id = ${payment.id} FOR UPDATE`);
    const left = payment.amountPaise - (await this.committed(payment.id, tx));
    const amount = Math.min(amountPaise, left);
    if (amount <= 0) return null;
    const id = uuidv7();
    await tx
      .insert(refunds)
      .values({ id, paymentId: payment.id, amountPaise: amount, reason, status: 'pending' });
    await this.outbox.add(tx, {
      aggregateType: 'payment',
      aggregateId: payment.id,
      type: REFUND_REQUESTED_EVENT,
      payload: { refundId: id, paymentId: payment.id, amountPaise: amount, reason },
    });
    return id;
  }

  /** Attendee dropped out of a paid plan: refund per the plan's policy at the time they cancelled. */
  async onAttendeeCancelled(
    eventId: string,
    userId: string,
    cancelledAt: Date,
  ): Promise<string | null> {
    const core = await this.store.core(eventId);
    if (!core) return null;
    return this.db.transaction(async (tx) => {
      const paid = await this.payments.capturedFor(userId, eventId, tx);
      if (!paid) return null;
      const left = paid.amountPaise - (await this.committed(paid.id, tx));
      const quote = refundFor(
        core.refundPolicy ?? DEFAULT_REFUND_POLICY,
        left,
        core.startsAt,
        cancelledAt,
      );
      // A free entry is a ticket, not money: it comes back whole or not at all.
      if (paid.method === 'credit' && quote.refundPaise < left) return null;
      return quote.refundPaise > 0
        ? this.request(tx, paid, quote.refundPaise, 'BEFORE_CUTOFF')
        : null;
    });
  }

  /** Host cancelled: every ticket is refunded in full and open checkouts are closed (F-PAY-02). */
  async onEventCancelled(eventId: string, now: Date = new Date()): Promise<number> {
    const rows = await this.db.select().from(payments).where(eq(payments.eventId, eventId));
    let refunded = 0;
    for (const p of rows) {
      if (p.status === 'captured' || p.status === 'partially_refunded') {
        const id = await this.db.transaction((tx) =>
          this.request(tx, p, p.amountPaise, 'HOST_CANCELLED'),
        );
        if (id) refunded += 1;
      } else if (p.status === 'created' || p.status === 'failed') {
        await this.payments.release(p, 'expired', now);
      }
    }
    return refunded;
  }

  /** Sends one refund to the gateway. Safe to call repeatedly: only pending/failed rows are claimed. */
  async execute(refundId: string): Promise<void> {
    const claimed = await this.db.transaction(async (tx) => {
      const [r] = await tx
        .update(refunds)
        .set({ status: 'processing', attempts: sql`${refunds.attempts} + 1` })
        .where(
          and(
            eq(refunds.id, refundId),
            inArray(refunds.status, ['pending', 'failed']),
            lt(refunds.attempts, MAX_REFUND_ATTEMPTS),
          ),
        )
        .returning();
      if (!r) return null;
      const [p] = await tx.select().from(payments).where(eq(payments.id, r.paymentId));
      return p ? { refund: r, payment: p } : null;
    });
    if (!claimed) return;
    const { refund, payment } = claimed;
    if (payment.method === 'credit') {
      // Credit-paid tickets refund as the credit itself; no money moves.
      const ref = `credit_${refund.id}`;
      await this.db.transaction(async (tx) => {
        await this.credits.restore(tx, payment.id);
        await tx
          .update(refunds)
          .set({ providerRefundId: ref, lastError: null })
          .where(eq(refunds.id, refund.id));
      });
      await this.settle(ref, 'processed');
      return;
    }
    if (!payment.providerPaymentId) {
      await this.fail(refund.id, 'Payment has no provider id');
      return;
    }
    try {
      const res = await this.gateway.refund({
        providerPaymentId: payment.providerPaymentId,
        amountPaise: refund.amountPaise,
        notes: { refundId: refund.id, reason: refund.reason },
      });
      await this.db
        .update(refunds)
        .set({ providerRefundId: res.providerRefundId, lastError: null })
        .where(eq(refunds.id, refund.id));
    } catch (err) {
      this.logger.warn(`Refund ${refund.id} failed to send: ${String(err)}`);
      await this.fail(refund.id, String(err));
    }
  }

  private async fail(refundId: string, error: string): Promise<void> {
    await this.db
      .update(refunds)
      .set({ status: 'failed', lastError: error.slice(0, 500) })
      .where(eq(refunds.id, refundId));
  }

  /** Every few minutes: resend refunds that never left or failed (bounded attempts). */
  async retryDue(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .select({ id: refunds.id })
      .from(refunds)
      .where(
        and(
          inArray(refunds.status, ['pending', 'failed']),
          lt(refunds.attempts, MAX_REFUND_ATTEMPTS),
          lt(refunds.updatedAt, new Date(now.getTime() - RETRY_AFTER_MS)),
        ),
      )
      .limit(200);
    for (const r of due) await this.execute(r.id);
    return due.length;
  }

  /** Admin "retry": a refund that ran out of attempts gets a fresh budget. */
  async adminRetry(refundId: string): Promise<void> {
    const [r] = await this.db
      .update(refunds)
      .set({ status: 'failed', attempts: 0 })
      .where(and(eq(refunds.id, refundId), eq(refunds.status, 'failed')))
      .returning({ id: refunds.id });
    if (!r) throw new AppError('CONFLICT', 'Only failed refunds can be retried');
    await this.execute(refundId);
  }

  /** `refund.processed` / `refund.failed` webhooks. */
  async settle(
    providerRefundId: string,
    outcome: 'processed' | 'failed',
    now: Date = new Date(),
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [r] = await tx
        .select()
        .from(refunds)
        .where(eq(refunds.providerRefundId, providerRefundId))
        .for('update');
      if (!r || r.status === 'processed') return false;
      if (outcome === 'failed') {
        await tx
          .update(refunds)
          .set({ status: 'failed', lastError: 'Gateway reported failure' })
          .where(eq(refunds.id, r.id));
        return true;
      }
      await tx
        .update(refunds)
        .set({ status: 'processed', processedAt: now })
        .where(eq(refunds.id, r.id));
      const [p] = await tx
        .update(payments)
        .set({
          refundedPaise: sql`least(${payments.amountPaise}, ${payments.refundedPaise} + ${r.amountPaise})`,
        })
        .where(eq(payments.id, r.paymentId))
        .returning();
      if (p)
        await tx
          .update(payments)
          .set({ status: p.refundedPaise >= p.amountPaise ? 'refunded' : 'partially_refunded' })
          .where(eq(payments.id, p.id));
      return true;
    });
  }
}
