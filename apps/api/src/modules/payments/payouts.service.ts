import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type CreateHostAccountBody,
  decodeCursor,
  encodeCursor,
  feeBreakdown,
  type HostAccount,
  type PayoutLedger,
  type PayoutView,
  TimeIdCursor,
} from '@touchgrass/shared';
import { and, desc, eq, inArray, lt, ne, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { PaymentsGateway } from '../../adapters/payments/payments.port.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import {
  hostAccounts,
  payments,
  payouts,
  payoutTransfers,
  refunds,
} from '../../infra/database/schema/index.js';
import { EventSearchService } from '../events/event-search.service.js';
import { EventStore } from '../events/event-store.service.js';
import { AppSettingsService } from '../platform/app-settings.service.js';
import { UsersService } from '../users/users.service.js';

export const MAX_PAYOUT_ATTEMPTS = 5;
const PAYOUT_LOOKBACK_MS = 30 * 24 * 3_600_000;
type PayoutRow = typeof payouts.$inferSelect;
type AccountRow = typeof hostAccounts.$inferSelect;

export interface PaymentShare {
  paymentId: string;
  providerPaymentId: string | null;
  amountPaise: number;
  refundedPaise: number;
  feeBps: number;
}

/** Ledger maths for one plan, per payment (each payment's own fee rate), summed (F-PAY-03). Pure. */
export function payoutLedger(shares: PaymentShare[]): {
  gross: number;
  refunds: number;
  fee: number;
  gst: number;
  net: number;
  transfers: { paymentId: string; amountPaise: number }[];
} {
  let gross = 0;
  let refundsTotal = 0;
  let fee = 0;
  let gst = 0;
  let net = 0;
  const transfers: { paymentId: string; amountPaise: number }[] = [];
  for (const s of shares) {
    const kept = Math.max(0, s.amountPaise - s.refundedPaise);
    const b = feeBreakdown(kept, s.feeBps);
    gross += s.amountPaise;
    refundsTotal += s.amountPaise - kept;
    fee += b.platformFeePaise;
    gst += b.gstPaise;
    net += b.hostNetPaise;
    if (b.hostNetPaise > 0) transfers.push({ paymentId: s.paymentId, amountPaise: b.hostNetPaise });
  }
  return { gross, refunds: refundsTotal, fee, gst, net, transfers };
}

function toAccount(a: AccountRow): HostAccount {
  return {
    status: a.status,
    legalBusinessName: a.legalBusinessName,
    contactName: a.contactName,
    email: a.email,
    createdAt: a.createdAt.toISOString(),
    activatedAt: a.activatedAt?.toISOString() ?? null,
  };
}

/**
 * Host payouts (F-PAY-03): once a paid plan has completed and the payout delay has passed, the plan's ledger is
 * frozen into a payout and the host's share of each payment is sent through Razorpay Route to their linked
 * (KYC'd) account. Without an active account the payout waits on hold and is released on activation.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly gateway: PaymentsGateway,
    private readonly store: EventStore,
    private readonly search: EventSearchService,
    private readonly settings: AppSettingsService,
    private readonly users: UsersService,
  ) {}

  // ---------- host account (KYC) ----------

  async account(userId: string): Promise<HostAccount | null> {
    const [a] = await this.db.select().from(hostAccounts).where(eq(hostAccounts.userId, userId));
    return a ? toAccount(a) : null;
  }

  async createAccount(userId: string, body: CreateHostAccountBody): Promise<HostAccount> {
    const existing = await this.account(userId);
    if (existing) return existing;
    const user = await this.users.findById(userId);
    if (!user?.phoneE164) throw AppError.notFound('User');
    let providerAccountId: string;
    try {
      ({ providerAccountId } = await this.gateway.createLinkedAccount({
        referenceId: userId.replace(/-/g, '').slice(0, 20),
        email: body.email,
        phoneE164: user.phoneE164,
        legalBusinessName: body.legalBusinessName,
        contactName: body.contactName,
      }));
    } catch (err) {
      this.logger.error(`Linked account creation failed for ${userId}: ${String(err)}`);
      throw new AppError(
        'PAYMENT_PROVIDER_ERROR',
        'Payout setup is having trouble. Try again soon.',
      );
    }
    const [row] = await this.db
      .insert(hostAccounts)
      .values({ userId, providerAccountId, status: 'created', ...body })
      .onConflictDoNothing()
      .returning();
    const account = row ? toAccount(row) : await this.account(userId);
    if (!account) throw new AppError('INTERNAL', 'Account vanished');
    return account;
  }

  /** `account.*` webhooks. Activation releases payouts waiting on KYC. */
  async onAccountStatus(
    providerAccountId: string,
    status: 'activated' | 'needs_clarification' | 'rejected',
    now: Date = new Date(),
  ): Promise<boolean> {
    const [a] = await this.db
      .update(hostAccounts)
      .set({ status, activatedAt: status === 'activated' ? now : null })
      .where(eq(hostAccounts.providerAccountId, providerAccountId))
      .returning();
    if (!a) return false;
    if (status === 'activated')
      await this.db
        .update(payouts)
        .set({ status: 'pending', holdReason: null })
        .where(and(eq(payouts.hostUserId, a.userId), eq(payouts.status, 'on_hold')));
    return true;
  }

  // ---------- creating payouts ----------

  /** Hourly: completed paid plans past the payout delay get their payout row (once). */
  async createDue(now: Date = new Date()): Promise<number> {
    const delayHours = await this.settings.get('payout_delay_hours');
    const endedBefore = new Date(now.getTime() - delayHours * 3_600_000);
    // Plans from the last 30 days: anything older already has its payout (the job runs hourly).
    const eventIds = await this.search.completedPaidEndedBetween(
      new Date(endedBefore.getTime() - PAYOUT_LOOKBACK_MS),
      endedBefore,
    );
    if (eventIds.length === 0) return 0;
    const existing = await this.db
      .select({ eventId: payouts.eventId })
      .from(payouts)
      .where(inArray(payouts.eventId, eventIds));
    const done = new Set(existing.map((e) => e.eventId));
    let created = 0;
    for (const eventId of eventIds) {
      if (done.has(eventId)) continue;
      if (await this.createFor(eventId)) created += 1;
    }
    return created;
  }

  async createFor(eventId: string): Promise<boolean> {
    const hosts = await this.store.hosts(eventId);
    const core = await this.store.core(eventId);
    const hostId = hosts.find((h) => h.role === 'host')?.userId ?? core?.creatorUserId;
    if (!hostId) return false;
    return this.db.transaction(async (tx) => {
      const paid = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.eventId, eventId),
            inArray(payments.status, ['captured', 'partially_refunded', 'refunded']),
          ),
        );
      // Refunds still in flight count as gone: the host is never paid money that is being returned.
      const pendingRefunds = paid.length
        ? await tx
            .select({
              paymentId: refunds.paymentId,
              n: sql<number>`coalesce(sum(${refunds.amountPaise}), 0)::int`,
            })
            .from(refunds)
            .where(
              and(
                inArray(
                  refunds.paymentId,
                  paid.map((p) => p.id),
                ),
                inArray(refunds.status, ['pending', 'processing']),
              ),
            )
            .groupBy(refunds.paymentId)
        : [];
      const inFlight = new Map(pendingRefunds.map((r) => [r.paymentId, r.n]));
      const ledger = payoutLedger(
        paid.map((p) => ({
          paymentId: p.id,
          providerPaymentId: p.providerPaymentId,
          amountPaise: p.amountPaise,
          refundedPaise: Math.min(p.amountPaise, p.refundedPaise + (inFlight.get(p.id) ?? 0)),
          feeBps: p.feeBps,
        })),
      );
      const [account] = await tx
        .select({ status: hostAccounts.status })
        .from(hostAccounts)
        .where(eq(hostAccounts.userId, hostId));
      const id = uuidv7();
      const status =
        ledger.net === 0 ? 'paid' : account?.status === 'activated' ? 'pending' : 'on_hold';
      const inserted = await tx
        .insert(payouts)
        .values({
          id,
          eventId,
          hostUserId: hostId,
          status,
          holdReason: status === 'on_hold' ? 'KYC_REQUIRED' : null,
          grossPaise: ledger.gross,
          refundsPaise: ledger.refunds,
          platformFeePaise: ledger.fee,
          gstPaise: ledger.gst,
          netPaise: ledger.net,
          paidAt: status === 'paid' ? new Date() : null,
        })
        .onConflictDoNothing()
        .returning({ id: payouts.id });
      if (inserted.length === 0) return false;
      if (ledger.transfers.length > 0)
        await tx.insert(payoutTransfers).values(
          ledger.transfers.map((t) => ({
            id: uuidv7(),
            payoutId: id,
            paymentId: t.paymentId,
            amountPaise: t.amountPaise,
            status: 'pending' as const,
          })),
        );
      return true;
    });
  }

  // ---------- sending payouts ----------

  /** Sends Route transfers for payouts that are ready (KYC active). Bounded retries. */
  async executeDue(): Promise<number> {
    const due = await this.db
      .select({ id: payouts.id })
      .from(payouts)
      .where(
        and(
          inArray(payouts.status, ['pending', 'failed']),
          lt(payouts.attempts, MAX_PAYOUT_ATTEMPTS),
        ),
      )
      .limit(100);
    for (const p of due) await this.execute(p.id);
    return due.length;
  }

  async execute(payoutId: string): Promise<void> {
    const claimed = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .update(payouts)
        .set({ status: 'processing', attempts: sql`${payouts.attempts} + 1` })
        .where(
          and(
            eq(payouts.id, payoutId),
            inArray(payouts.status, ['pending', 'failed']),
            lt(payouts.attempts, MAX_PAYOUT_ATTEMPTS),
          ),
        )
        .returning();
      if (!p) return null;
      const [account] = await tx
        .select()
        .from(hostAccounts)
        .where(eq(hostAccounts.userId, p.hostUserId));
      if (account?.status !== 'activated') {
        await tx
          .update(payouts)
          .set({ status: 'on_hold', holdReason: 'KYC_REQUIRED' })
          .where(eq(payouts.id, p.id));
        return null;
      }
      const transfers = await tx
        .select({
          t: payoutTransfers,
          providerPaymentId: payments.providerPaymentId,
          method: payments.method,
        })
        .from(payoutTransfers)
        .innerJoin(payments, eq(payments.id, payoutTransfers.paymentId))
        .where(
          and(
            eq(payoutTransfers.payoutId, p.id),
            inArray(payoutTransfers.status, ['pending', 'failed']),
          ),
        );
      return { payout: p, account, transfers };
    });
    if (!claimed) return;
    let failed = false;
    for (const { t, providerPaymentId, method } of claimed.transfers) {
      if (!providerPaymentId && method !== 'credit') {
        failed = true;
        continue;
      }
      try {
        const notes = { payoutId: claimed.payout.id, paymentId: t.paymentId };
        // Credit-paid seats (F-GRW-01) have no captured payment to split; the platform pays from its balance.
        const res = providerPaymentId
          ? await this.gateway.transfer({
              providerPaymentId,
              providerAccountId: claimed.account.providerAccountId,
              amountPaise: t.amountPaise,
              notes,
            })
          : await this.gateway.directTransfer({
              providerAccountId: claimed.account.providerAccountId,
              amountPaise: t.amountPaise,
              notes,
            });
        await this.db
          .update(payoutTransfers)
          .set({ status: 'processing', providerTransferId: res.providerTransferId })
          .where(eq(payoutTransfers.id, t.id));
      } catch (err) {
        failed = true;
        this.logger.warn(`Transfer ${t.id} failed: ${String(err)}`);
        await this.db
          .update(payoutTransfers)
          .set({ status: 'failed' })
          .where(eq(payoutTransfers.id, t.id));
      }
    }
    if (failed)
      await this.db
        .update(payouts)
        .set({ status: 'failed' })
        .where(eq(payouts.id, claimed.payout.id));
    else await this.completeIfSettled(claimed.payout.id);
  }

  /** `transfer.processed` / `transfer.failed` webhooks. */
  async onTransfer(providerTransferId: string, outcome: 'processed' | 'failed'): Promise<boolean> {
    const [t] = await this.db
      .update(payoutTransfers)
      .set({ status: outcome })
      .where(
        and(
          eq(payoutTransfers.providerTransferId, providerTransferId),
          ne(payoutTransfers.status, 'processed'),
        ),
      )
      .returning();
    if (!t) return false;
    if (outcome === 'failed')
      await this.db
        .update(payouts)
        .set({ status: 'failed' })
        .where(and(eq(payouts.id, t.payoutId), ne(payouts.status, 'paid')));
    else await this.completeIfSettled(t.payoutId);
    return true;
  }

  private async completeIfSettled(payoutId: string, now: Date = new Date()): Promise<void> {
    await this.db.execute(sql`
      UPDATE payouts SET status = 'paid', paid_at = ${now}
      WHERE id = ${payoutId} AND status <> 'paid'
        AND NOT EXISTS (
          SELECT 1 FROM payout_transfers WHERE payout_id = ${payoutId} AND status <> 'processed'
        )`);
  }

  /** Admin "retry" for a payout that ran out of attempts. */
  async adminRetry(payoutId: string): Promise<void> {
    const [p] = await this.db
      .update(payouts)
      .set({ status: 'pending', attempts: 0 })
      .where(and(eq(payouts.id, payoutId), eq(payouts.status, 'failed')))
      .returning({ id: payouts.id });
    if (!p) throw new AppError('CONFLICT', 'Only failed payouts can be retried');
    await this.execute(payoutId);
  }

  // ---------- ledger ----------

  async ledger(hostId: string, cursor: string | undefined, limit: number): Promise<PayoutLedger> {
    const after = cursor ? decodeCursor(cursor, TimeIdCursor) : null;
    const rows = await this.db
      .select()
      .from(payouts)
      .where(
        and(
          eq(payouts.hostUserId, hostId),
          after
            ? or(
                lt(payouts.createdAt, new Date(after.t)),
                and(eq(payouts.createdAt, new Date(after.t)), lt(payouts.id, after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(payouts.createdAt), desc(payouts.id))
      .limit(limit + 1);
    const [totals] = await this.db
      .select({
        paid: sql<number>`coalesce(sum(${payouts.netPaise}) FILTER (WHERE ${payouts.status} = 'paid'), 0)::int`,
        pending: sql<number>`coalesce(sum(${payouts.netPaise}) FILTER (WHERE ${payouts.status} <> 'paid'), 0)::int`,
      })
      .from(payouts)
      .where(eq(payouts.hostUserId, hostId));
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: await this.views(page),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
      totals: { paidPaise: totals?.paid ?? 0, pendingPaise: totals?.pending ?? 0 },
    };
  }

  async views(rows: PayoutRow[]): Promise<PayoutView[]> {
    const cores = await this.store.coresByIds([...new Set(rows.map((r) => r.eventId))]);
    const titles = new Map(cores.map((c) => [c.id, c.title]));
    return rows.map((p) => ({
      id: p.id,
      eventId: p.eventId,
      eventTitle: titles.get(p.eventId) ?? '',
      status: p.status,
      grossPaise: p.grossPaise,
      refundsPaise: p.refundsPaise,
      platformFeePaise: p.platformFeePaise,
      gstPaise: p.gstPaise,
      netPaise: p.netPaise,
      holdReason: p.holdReason,
      createdAt: p.createdAt.toISOString(),
      paidAt: p.paidAt?.toISOString() ?? null,
    }));
  }

  /** Account data: KYC details are the provider's; we keep only what payouts need, anonymised on erasure. */
  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db.select().from(payouts).where(eq(payouts.hostUserId, userId));
    return { hostAccount: await this.account(userId), payouts: await this.views(rows) };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx
      .update(hostAccounts)
      .set({ legalBusinessName: '', contactName: '', email: '' })
      .where(eq(hostAccounts.userId, userId));
  }
}
