import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import {
  PaymentsGateway,
  type PaymentWebhookEvent,
} from '../../adapters/payments/payments.port.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { payments, paymentWebhookEvents } from '../../infra/database/schema/index.js';
import { QUEUE_REGISTRY, type QueueRegistry } from '../../infra/queue/queue.module.js';
import { QUEUES } from '../../infra/queue/queues.js';
import { RsvpService } from '../events/rsvp.service.js';
import { nextReceiptNumber, PaymentsService } from './payments.service.js';
import { PayoutsService } from './payouts.service.js';
import { RefundsService } from './refunds.service.js';

const MAX_ATTEMPTS = 10;
const STALE_MS = 2 * 60_000;

/**
 * Razorpay webhooks (F-PAY-01..03). The HTTP handler only verifies the signature, records the delivery once
 * (by provider event id) and queues it; the worker applies it. Every handler is idempotent, so redeliveries,
 * retries and out-of-order events are harmless.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
    private readonly gateway: PaymentsGateway,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly payouts: PayoutsService,
    private readonly rsvp: RsvpService,
  ) {}

  /** Returns false for a duplicate delivery (already recorded). Throws on a bad signature. */
  async ingest(
    rawBody: string,
    signature: string,
    providerEventId: string | null,
  ): Promise<boolean> {
    if (!signature || !this.gateway.verifyWebhookSignature(rawBody, signature))
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook signature');
    let parsed: PaymentWebhookEvent;
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
      parsed = this.gateway.parseWebhook(rawBody);
    } catch {
      throw new AppError('VALIDATION_FAILED', 'Malformed webhook body');
    }
    const id = providerEventId ?? `sha256:${createHash('sha256').update(rawBody).digest('hex')}`;
    const inserted = await this.db
      .insert(paymentWebhookEvents)
      .values({ providerEventId: id, type: parsed.rawType, body, status: 'received' })
      .onConflictDoNothing()
      .returning({ id: paymentWebhookEvents.providerEventId });
    if (inserted.length === 0) return false;
    await this.enqueue(id);
    return true;
  }

  private async enqueue(id: string): Promise<void> {
    await this.queues
      .get(QUEUES.webhooks)
      .add('razorpay', { id }, { jobId: `wh-${id.replace(/:/g, '_')}` });
  }

  /** Worker: apply one recorded delivery. Throws on failure so the queue retries it. */
  async process(id: string, now: Date = new Date()): Promise<void> {
    const [row] = await this.db
      .select()
      .from(paymentWebhookEvents)
      .where(eq(paymentWebhookEvents.providerEventId, id));
    if (!row || row.status === 'processed' || row.status === 'ignored') return;
    try {
      const handled = await this.apply(this.gateway.parseWebhook(JSON.stringify(row.body)), now);
      await this.db
        .update(paymentWebhookEvents)
        .set({ status: handled ? 'processed' : 'ignored', processedAt: now, lastError: null })
        .where(eq(paymentWebhookEvents.providerEventId, id));
    } catch (err) {
      await this.db
        .update(paymentWebhookEvents)
        .set({
          status: 'failed',
          attempts: sql`${paymentWebhookEvents.attempts} + 1`,
          lastError: String(err).slice(0, 500),
        })
        .where(eq(paymentWebhookEvents.providerEventId, id));
      throw err;
    }
  }

  private async apply(e: PaymentWebhookEvent, now: Date): Promise<boolean> {
    switch (e.type) {
      case 'payment.captured':
      case 'order.paid':
        return e.providerOrderId ? this.captured(e, now) : false;
      case 'payment.failed':
        return e.providerOrderId ? this.failed(e.providerOrderId) : false;
      case 'refund.processed':
      case 'refund.failed':
        return e.providerRefundId
          ? this.refunds.settle(
              e.providerRefundId,
              e.type === 'refund.processed' ? 'processed' : 'failed',
              now,
            )
          : false;
      case 'transfer.processed':
      case 'transfer.failed':
        return e.providerTransferId
          ? this.payouts.onTransfer(
              e.providerTransferId,
              e.type === 'transfer.processed' ? 'processed' : 'failed',
            )
          : false;
      case 'account.activated':
      case 'account.needs_clarification':
      case 'account.rejected':
        return e.providerAccountId
          ? this.payouts.onAccountStatus(
              e.providerAccountId,
              e.type === 'account.activated'
                ? 'activated'
                : e.type === 'account.rejected'
                  ? 'rejected'
                  : 'needs_clarification',
              now,
            )
          : false;
      case 'payment.authorized':
      case 'unknown':
        return false;
    }
  }

  /**
   * Money arrived. The held seat becomes a ticket; a lapsed hold still gets a seat if one is free; otherwise
   * (or for a second payment for the same plan) the money goes straight back.
   */
  private async captured(e: PaymentWebhookEvent, now: Date): Promise<boolean> {
    const orderId = e.providerOrderId;
    if (!orderId) return false;
    const [p] = await this.db.select().from(payments).where(eq(payments.providerOrderId, orderId));
    if (!p) return false;
    if (p.status !== 'created' && p.status !== 'failed' && p.status !== 'expired') return true;
    if (e.amountPaise !== undefined && e.amountPaise !== p.amountPaise)
      throw new Error(
        `Amount mismatch on ${p.id}: expected ${String(p.amountPaise)}, got ${String(e.amountPaise)}`,
      );
    const finish = async (
      tx: Parameters<Parameters<RsvpService['confirmPaid']>[2]>[0],
      seated: boolean,
    ) => {
      const [locked] = await tx.select().from(payments).where(eq(payments.id, p.id)).for('update');
      if (!locked || !['created', 'failed', 'expired'].includes(locked.status)) return;
      const [captured] = await tx
        .update(payments)
        .set({
          status: 'captured',
          providerPaymentId: e.providerPaymentId ?? null,
          method: e.method ?? null,
          capturedAt: now,
          receiptNumber: await nextReceiptNumber(tx, now),
        })
        .where(eq(payments.id, p.id))
        .returning();
      if (!captured) return;
      await this.payments.announceCaptured(tx, captured);
      const others = await tx
        .select({ id: payments.id })
        .from(payments)
        .where(
          and(
            eq(payments.eventId, p.eventId),
            p.userId ? eq(payments.userId, p.userId) : sql`false`,
            inArray(payments.status, ['captured', 'partially_refunded']),
            sql`${payments.id} <> ${p.id}`,
          ),
        );
      if (others.length > 0)
        await this.refunds.request(tx, captured, captured.amountPaise, 'DUPLICATE');
      else if (!seated)
        await this.refunds.request(tx, captured, captured.amountPaise, 'HOLD_EXPIRED');
    };
    if (!p.userId) {
      // The buyer erased their account mid-checkout: record the money and return it.
      await this.db.transaction((tx) => finish(tx, false));
      return true;
    }
    await this.rsvp.confirmPaid(p.eventId, p.userId, finish, now);
    return true;
  }

  /** The bank said no. The hold stays until it lapses, so the person can try again on the same order. */
  private async failed(orderId: string): Promise<boolean> {
    const res = await this.db
      .update(payments)
      .set({ status: 'failed' })
      .where(and(eq(payments.providerOrderId, orderId), eq(payments.status, 'created')))
      .returning({ id: payments.id });
    return res.length > 0;
  }

  /** Every few minutes: re-queue deliveries that were recorded but never applied (queue hiccup, crash). */
  async sweep(now: Date = new Date()): Promise<number> {
    const stale = await this.db
      .select({ id: paymentWebhookEvents.providerEventId })
      .from(paymentWebhookEvents)
      .where(
        and(
          inArray(paymentWebhookEvents.status, ['received', 'failed']),
          lt(paymentWebhookEvents.attempts, MAX_ATTEMPTS),
          lt(paymentWebhookEvents.updatedAt, new Date(now.getTime() - STALE_MS)),
        ),
      )
      .limit(200);
    for (const { id } of stale) {
      try {
        await this.process(id, now);
      } catch (err) {
        this.logger.warn(`Webhook ${id} still failing: ${String(err)}`);
      }
    }
    return stale.length;
  }
}
