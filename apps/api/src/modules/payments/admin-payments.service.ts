import { Inject, Injectable } from '@nestjs/common';
import type { AdminPaymentsOverview, PersonCard } from '@touchgrass/shared';
import { desc, inArray, sql } from 'drizzle-orm';
import { DB, type Database } from '../../infra/database/database.module.js';
import { payments, payouts, refunds } from '../../infra/database/schema/index.js';
import { EventStore } from '../events/event-store.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { PaymentsService, toRefundView } from './payments.service.js';
import { PayoutsService } from './payouts.service.js';

const RECENT = 50;
const UNKNOWN: Omit<PersonCard, 'id'> = {
  displayName: '—',
  photo: null,
  verified: false,
  mutualFriendCount: 0,
};

/** Payments, refunds and payouts overview for the admin dashboard (F-WEB-03). */
@Injectable()
export class AdminPaymentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
    private readonly store: EventStore,
    private readonly people: PeopleService,
  ) {}

  async overview(adminId: string): Promise<AdminPaymentsOverview> {
    const [[money], [out], recentPayments, recentRefunds, recentPayouts] = await Promise.all([
      this.db
        .select({
          captured: sql<number>`coalesce(sum(${payments.amountPaise}) FILTER (WHERE ${payments.status} IN ('captured','partially_refunded','refunded')), 0)::bigint::int`,
          refunded: sql<number>`coalesce(sum(${payments.refundedPaise}), 0)::bigint::int`,
          fee: sql<number>`coalesce(sum(round((${payments.amountPaise} - ${payments.refundedPaise}) * ${payments.feeBps} / 10000.0)) FILTER (WHERE ${payments.status} IN ('captured','partially_refunded','refunded')), 0)::bigint::int`,
        })
        .from(payments),
      this.db
        .select({
          paid: sql<number>`coalesce(sum(${payouts.netPaise}) FILTER (WHERE ${payouts.status} = 'paid'), 0)::bigint::int`,
          pending: sql<number>`coalesce(sum(${payouts.netPaise}) FILTER (WHERE ${payouts.status} <> 'paid'), 0)::bigint::int`,
          fee: sql<number>`coalesce(sum(${payouts.platformFeePaise}), 0)::bigint::int`,
          gst: sql<number>`coalesce(sum(${payouts.gstPaise}), 0)::bigint::int`,
        })
        .from(payouts),
      this.db
        .select()
        .from(payments)
        .where(inArray(payments.status, ['captured', 'partially_refunded', 'refunded', 'failed']))
        .orderBy(desc(payments.createdAt))
        .limit(RECENT),
      this.db.select().from(refunds).orderBy(desc(refunds.createdAt)).limit(RECENT),
      this.db.select().from(payouts).orderBy(desc(payouts.createdAt)).limit(RECENT),
    ]);
    const refundPayments = recentRefunds.length
      ? await this.db
          .select({ id: payments.id, eventId: payments.eventId })
          .from(payments)
          .where(
            inArray(
              payments.id,
              recentRefunds.map((r) => r.paymentId),
            ),
          )
      : [];
    const cores = await this.store.coresByIds([
      ...new Set([...refundPayments.map((p) => p.eventId)]),
    ]);
    const titles = new Map(cores.map((c) => [c.id, c.title]));
    const eventOf = new Map(refundPayments.map((p) => [p.id, p.eventId]));
    const cards = await this.people.cards(
      adminId,
      [
        ...recentPayments.flatMap((p) => (p.userId ? [p.userId] : [])),
        ...recentPayouts.map((p) => p.hostUserId),
      ],
      { includeSelf: true },
    );
    const card = (id: string | null): PersonCard =>
      (id ? cards.get(id) : undefined) ?? {
        id: id ?? '00000000-0000-7000-8000-000000000000',
        ...UNKNOWN,
      };
    const paymentViews = await this.payments.views(recentPayments);
    const payoutViews = await this.payouts.views(recentPayouts);
    const platformFee = out?.fee && out.fee > 0 ? out.fee : (money?.fee ?? 0);
    return {
      totals: {
        capturedPaise: money?.captured ?? 0,
        refundedPaise: money?.refunded ?? 0,
        platformFeePaise: platformFee,
        gstPaise: out?.gst ?? 0,
        payoutsPaidPaise: out?.paid ?? 0,
        payoutsPendingPaise: out?.pending ?? 0,
      },
      payments: paymentViews.map(({ refunds: _refunds, ...rest }, i) => {
        const row = recentPayments[i];
        return { ...rest, buyer: card(row?.userId ?? null), method: row?.method ?? null };
      }),
      refunds: recentRefunds.map((r) => ({
        ...toRefundView(r),
        paymentId: r.paymentId,
        eventTitle: titles.get(eventOf.get(r.paymentId) ?? '') ?? '',
      })),
      payouts: payoutViews.map((v, i) => ({
        ...v,
        host: card(recentPayouts[i]?.hostUserId ?? null),
      })),
    };
  }
}
