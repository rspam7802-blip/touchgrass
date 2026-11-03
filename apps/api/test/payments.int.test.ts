import type {
  AdminPaymentsOverview,
  CheckoutPage,
  CheckoutResult,
  EventAnalytics,
  EventDetail,
  HostAnalytics,
  HostStatus,
  PaymentView,
  PayoutLedger,
  PerkPass,
  PerkPassPreview,
  Receipt,
  RefundQuote,
} from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailMessage } from '../src/adapters/email/email.port.js';
import { EmailSender } from '../src/adapters/email/email.port.js';
import {
  FakePaymentsGateway,
  type SimulatedWebhook,
} from '../src/adapters/payments/fake.payments.js';
import { EventStore } from '../src/modules/events/event-store.service.js';
import { PaymentsHandlers } from '../src/modules/payments/payments.handlers.js';
import { PaymentsService } from '../src/modules/payments/payments.service.js';
import { PayoutsService } from '../src/modules/payments/payouts.service.js';
import { WebhooksService } from '../src/modules/payments/webhooks.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { DomainEventBus } from '../src/worker/domain-event-bus.js';
import { detail, idem, planBody, plot, rsvp, shiftEvent, verifiedMember } from './event-helpers.js';
import {
  bearer,
  cityAndHood,
  createHarness,
  fromIp,
  type Harness,
  member,
  type Member,
  onboard,
  signIn,
} from './harness.js';

class CapturingEmail extends EmailSender {
  readonly sent: EmailMessage[] = [];
  send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    return Promise.resolve();
  }
}

let h: Harness;
const gateway = new FakePaymentsGateway();
const email = new CapturingEmail();
let admin: Member;
const PRICE = 50_000;

beforeAll(async () => {
  h = await createHarness({ payments: gateway, email });
  const s = await signIn(h);
  await onboard(h, s.accessToken);
  await h.app.get(UsersService).grantRole(s.user.id, 'admin', null);
  const refreshed = await request(h.http)
    .post('/v1/auth/refresh')
    .set(...fromIp())
    .send({ refreshToken: s.refreshToken })
    .expect(200);
  admin = { id: s.user.id, token: refreshed.body.accessToken as string, phone: s.phone };
});
afterAll(async () => {
  await h.close();
});

// ---------- helpers ----------

const dispatched = new Set<string>();
/**
 * Runs the worker's payment handlers over outbox rows not yet handled in this suite, repeating while handlers
 * add new rows (as the relay would).
 */
async function drain(): Promise<void> {
  const bus = new DomainEventBus();
  h.app.get(PaymentsHandlers).registerOn(bus);
  for (;;) {
    const { rows } = await h.pool.query<{
      id: string;
      aggregate_type: string;
      aggregate_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      `SELECT * FROM outbox_events WHERE event_type IN
        ('rsvp.cancelled','event.cancelled','payment.captured','payment.refund_requested') ORDER BY created_at`,
    );
    const fresh = rows.filter((r) => !dispatched.has(r.id));
    if (fresh.length === 0) return;
    for (const r of fresh) {
      dispatched.add(r.id);
      await bus.dispatch({
        eventId: r.id,
        aggregateType: r.aggregate_type,
        aggregateId: r.aggregate_id,
        type: r.event_type,
        payload: r.payload,
        occurredAt: r.created_at.toISOString(),
      });
    }
  }
}

/** Delivers a signed webhook over HTTP, then runs the worker step. */
async function deliver(w: SimulatedWebhook, eventId: string = w.eventId): Promise<void> {
  await request(h.http)
    .post('/v1/webhooks/razorpay')
    .set('content-type', 'application/json')
    .set('x-razorpay-signature', w.signature)
    .set('x-razorpay-event-id', eventId)
    .send(w.rawBody)
    .expect(200);
  await h.app.get(WebhooksService).process(eventId);
}

async function approvedHost(): Promise<Member> {
  const m = await verifiedMember(h);
  const app = await request(h.http)
    .post('/v1/host/applications')
    .set(...bearer(m.token))
    .set(...idem())
    .send({
      about: 'I run a weekend cycling group in Gachibowli.',
      experience: 'Hosted thirty rides for groups of ten to forty.',
      eventIdeas: 'Sunrise rides ending at a partner cafe.',
    })
    .expect(201);
  await request(h.http)
    .post(`/v1/admin/host-applications/${app.body.id as string}/review`)
    .set(...bearer(admin.token))
    .send({ decision: 'approved' })
    .expect(201);
  return m;
}

async function paidPlan(
  host: Member,
  overrides: Record<string, unknown> = {},
): Promise<EventDetail> {
  return plot(h, host, { pricePaise: PRICE, ...overrides });
}

const checkout = (m: Member, eventId: string, body: Record<string, unknown> = {}) =>
  request(h.http)
    .post(`/v1/events/${eventId}/checkout`)
    .set(...bearer(m.token))
    .set(...idem())
    .send(body);

const tokenOf = (r: CheckoutResult): string => {
  if (r.kind !== 'checkout') throw new Error('expected a checkout');
  return r.session.checkoutUrl.split('/pay/')[1] ?? '';
};

async function orderOf(paymentId: string): Promise<string> {
  const { rows } = await h.pool.query<{ provider_order_id: string }>(
    'SELECT provider_order_id FROM payments WHERE id = $1',
    [paymentId],
  );
  return rows[0]?.provider_order_id ?? '';
}

/** Checkout + captured webhook: the buyer ends up going. */
async function buy(m: Member, eventId: string): Promise<string> {
  const res = (await checkout(m, eventId).expect(201)).body as CheckoutResult;
  if (res.kind !== 'checkout') throw new Error('no checkout');
  await deliver(gateway.simulatePaymentCaptured(await orderOf(res.session.paymentId)));
  return res.session.paymentId;
}

const payment = async (m: Member, id: string): Promise<PaymentView> =>
  (
    await request(h.http)
      .get(`/v1/payments/${id}`)
      .set(...bearer(m.token))
      .expect(200)
  ).body as PaymentView;

// ---------- F-HST-01 ----------

describe('open hosting and host applications (F-HST-01)', () => {
  it('verified people host free plans; paid plans need an approved application and no +1s', async () => {
    const host = await verifiedMember(h);
    const before = (
      await request(h.http)
        .get('/v1/host/status')
        .set(...bearer(host.token))
        .expect(200)
    ).body as HostStatus;
    expect(before).toMatchObject({
      canHostFree: true,
      canHostPaid: false,
      application: null,
      platformFeeBps: 1000,
      gstBps: 1800,
    });
    const refused = await request(h.http)
      .post('/v1/events')
      .set(...bearer(host.token))
      .set(...idem())
      .send({ ...(await planBody(h)), pricePaise: PRICE });
    expect(refused.status).toBe(403);
    expect(refused.body.error.details.reason).toBe('PAID_NEEDS_HOST_APPROVAL');

    const body = {
      about: 'I host board game nights every Friday.',
      experience: 'Two years, about twenty people each week.',
      eventIdeas: 'Paid tournaments with prizes and snacks.',
    };
    const app = await request(h.http)
      .post('/v1/host/applications')
      .set(...bearer(host.token))
      .set(...idem())
      .send(body)
      .expect(201);
    expect(app.body.status).toBe('pending');
    await request(h.http)
      .post('/v1/host/applications')
      .set(...bearer(host.token))
      .set(...idem())
      .send(body)
      .expect(409);

    const queue = await request(h.http)
      .get('/v1/admin/host-applications')
      .set(...bearer(admin.token))
      .expect(200);
    expect(queue.body.items.some((a: { id: string }) => a.id === app.body.id)).toBe(true);
    await request(h.http)
      .post(`/v1/admin/host-applications/${app.body.id as string}/review`)
      .set(...bearer(host.token))
      .send({ decision: 'approved' })
      .expect(403);
    await request(h.http)
      .post(`/v1/admin/host-applications/${app.body.id as string}/review`)
      .set(...bearer(admin.token))
      .send({ decision: 'approved', note: 'Welcome aboard' })
      .expect(201);

    const after = (
      await request(h.http)
        .get('/v1/host/status')
        .set(...bearer(host.token))
        .expect(200)
    ).body as HostStatus;
    expect(after.canHostPaid).toBe(true);
    const withPlusOnes = await request(h.http)
      .post('/v1/events')
      .set(...bearer(host.token))
      .set(...idem())
      .send({ ...(await planBody(h)), pricePaise: PRICE, allowPlusOnes: true });
    expect(withPlusOnes.body.error.details.reason).toBe('NO_PLUS_ONES');
    const plan = await paidPlan(host);
    expect(plan.pricePaise).toBe(PRICE);
    expect(plan.refundPolicy).toEqual({ kind: 'full', cutoffHours: 24, partialPct: null });

    const unverified = await member(h);
    const nope = await request(h.http)
      .post('/v1/host/applications')
      .set(...bearer(unverified.token))
      .set(...idem())
      .send(body);
    expect(nope.status).toBe(403);
    expect(nope.body.error.code).toBe('VERIFICATION_REQUIRED');
  });
});

// ---------- F-PAY-01 ----------

describe('ticketing (F-PAY-01)', () => {
  it('holds a seat, confirms only on a verified webhook, issues a ticket and a receipt (once)', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const buyer = await member(h);

    const free = await rsvp(h, buyer, plan.id);
    expect(free.status).toBe(403);
    expect(free.body.error.details.reason).toBe('PAYMENT_REQUIRED');

    const started = (
      await checkout(buyer, plan.id, { receiptEmail: 'priya@example.com' }).expect(201)
    ).body as CheckoutResult;
    if (started.kind !== 'checkout') throw new Error('expected checkout');
    expect(started.session).toMatchObject({ status: 'created', amountPaise: PRICE });
    const held = (await detail(h, buyer, plan.id).expect(200)).body as EventDetail;
    expect(held.viewer.rsvp).toBe('held');
    expect(held.viewer.payment).toMatchObject({ id: started.session.paymentId, status: 'created' });
    expect(held.spotsLeft).toBe(plan.spotsLeft - 1);
    await request(h.http)
      .get(`/v1/events/${plan.id}/ticket`)
      .set(...bearer(buyer.token))
      .expect(403);

    // The public checkout page reads the order by its token; the token is unguessable.
    const token = tokenOf(started);
    const page = (
      await request(h.http)
        .get(`/v1/checkout/${token}`)
        .set(...fromIp())
        .expect(200)
    ).body as CheckoutPage;
    expect(page).toMatchObject({ keyId: 'rzp_test_fake', simulate: true, amountPaise: PRICE });
    await request(h.http)
      .get(`/v1/checkout/${'x'.repeat(43)}`)
      .set(...fromIp())
      .expect(404);

    // Asking again reuses the same order (fresh link).
    const again = (await checkout(buyer, plan.id).expect(201)).body as CheckoutResult;
    if (again.kind !== 'checkout') throw new Error('expected checkout');
    expect(again.session.paymentId).toBe(started.session.paymentId);

    // A forged webhook is rejected and changes nothing.
    const forged = gateway.simulatePaymentCaptured(page.providerOrderId);
    await request(h.http)
      .post('/v1/webhooks/razorpay')
      .set('content-type', 'application/json')
      .set('x-razorpay-signature', 'deadbeef'.repeat(8))
      .send(forged.rawBody)
      .expect(401);
    expect((await payment(buyer, started.session.paymentId)).status).toBe('created');

    // The page "pays" (dev simulation goes through the real webhook path); the worker applies it.
    await request(h.http)
      .post(`/v1/checkout/${tokenOf(again)}/simulate`)
      .set(...fromIp())
      .send({ outcome: 'success' })
      .expect(204);
    const { rows: events } = await h.pool.query<{ provider_event_id: string }>(
      `SELECT provider_event_id FROM payment_webhook_events WHERE status = 'received' ORDER BY created_at DESC LIMIT 1`,
    );
    const eventId = events[0]?.provider_event_id ?? '';
    await h.app.get(WebhooksService).process(eventId);
    await h.app.get(WebhooksService).process(eventId);

    const paid = await payment(buyer, started.session.paymentId);
    expect(paid).toMatchObject({ status: 'captured', amountPaise: PRICE });
    expect(paid.receiptNumber).toMatch(/^TG-\d{4}-\d{6}$/);
    const going = (await detail(h, buyer, plan.id).expect(200)).body as EventDetail;
    expect(going.viewer.rsvp).toBe('going');
    await request(h.http)
      .get(`/v1/events/${plan.id}/ticket`)
      .set(...bearer(buyer.token))
      .expect(200);

    const receipt = (
      await request(h.http)
        .get(`/v1/payments/${paid.id}/receipt`)
        .set(...bearer(buyer.token))
        .expect(200)
    ).body as Receipt;
    expect(receipt).toMatchObject({
      amountPaise: PRICE,
      platformFeePaise: 5_000,
      gstPaise: 900,
      netPaidPaise: PRICE,
      method: 'upi',
      sellerName: 'TouchGrass',
    });
    // Receipts and payments are private.
    const stranger = await member(h);
    await request(h.http)
      .get(`/v1/payments/${paid.id}/receipt`)
      .set(...bearer(stranger.token))
      .expect(404);
    await request(h.http)
      .get(`/v1/payments/${paid.id}`)
      .set(...bearer(stranger.token))
      .expect(404);

    const list = await request(h.http)
      .get('/v1/payments')
      .set(...bearer(buyer.token))
      .expect(200);
    expect(list.body.items.map((p: PaymentView) => p.id)).toEqual([paid.id]);
    expect(
      (
        await request(h.http)
          .get('/v1/payments/receipt-email')
          .set(...bearer(buyer.token))
          .expect(200)
      ).body,
    ).toEqual({ email: 'priya@example.com' });

    const before = email.sent.length;
    await drain();
    await h.app.get(PaymentsHandlers).emailReceipt(paid.id);
    const mine = email.sent.slice(before).filter((m) => m.to === 'priya@example.com');
    expect(mine).toHaveLength(1);
    expect(mine[0]?.subject).toContain(paid.receiptNumber ?? '');
    expect(mine[0]?.text).toContain('₹500');

    const { rows: going2 } = await h.pool.query<{ payload: { via: string } }>(
      `SELECT payload FROM outbox_events WHERE aggregate_id = $1 AND event_type = 'rsvp.going'`,
      [plan.id],
    );
    expect(going2.map((r) => r.payload.via)).toContain('paid');
  });

  it('a checkout can be abandoned; failures keep the hold so the person can retry', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const buyer = await member(h);
    const started = (await checkout(buyer, plan.id).expect(201)).body as CheckoutResult;
    if (started.kind !== 'checkout') throw new Error('expected checkout');
    const order = await orderOf(started.session.paymentId);
    await deliver(gateway.simulatePaymentFailed(order));
    expect((await payment(buyer, started.session.paymentId)).status).toBe('failed');
    expect(((await detail(h, buyer, plan.id)).body as EventDetail).viewer.rsvp).toBe('held');
    await request(h.http)
      .post(`/v1/payments/${started.session.paymentId}/cancel`)
      .set(...bearer(buyer.token))
      .expect(204);
    const after = (await detail(h, buyer, plan.id)).body as EventDetail;
    expect(after.viewer.rsvp).toBe('cancelled');
    expect(after.spotsLeft).toBe(plan.spotsLeft);
  });

  it('only one of many concurrent buyers gets the last spot; the rest join the waitlist', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host, { capacity: 2 });
    const buyers = await Promise.all(Array.from({ length: 8 }, () => member(h)));
    const results = await Promise.all(buyers.map((b) => checkout(b, plan.id)));
    const kinds = results.map((r) => (r.body as CheckoutResult).kind);
    expect(kinds.filter((k) => k === 'checkout')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'waitlisted')).toHaveLength(7);
    const { rows } = await h.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rsvps WHERE event_id = $1 AND status IN ('going','checked_in','held')`,
      [plan.id],
    );
    expect(rows[0]?.n).toBe(2);
  });

  it('holds lapse after ten minutes; a late payment without a seat is refunded in full', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host, { capacity: 2 });
    const [a, b] = [await member(h), await member(h)];
    const held = (await checkout(a, plan.id).expect(201)).body as CheckoutResult;
    if (held.kind !== 'checkout') throw new Error('expected checkout');
    expect(((await checkout(b, plan.id).expect(201)).body as CheckoutResult).kind).toBe(
      'waitlisted',
    );

    const expired = await h.app
      .get(PaymentsService)
      .expireHolds(new Date(Date.now() + 11 * 60_000));
    expect(expired).toBeGreaterThanOrEqual(1);
    expect((await payment(a, held.session.paymentId)).status).toBe('expired');
    const bView = (await detail(h, b, plan.id)).body as EventDetail;
    expect(bView.viewer.offer).not.toBeNull();

    // A's bank answers late. B's offer reserves the seat, so A is refunded.
    await deliver(gateway.simulatePaymentCaptured(await orderOf(held.session.paymentId)));
    const late = await payment(a, held.session.paymentId);
    expect(late.status).toBe('captured');
    expect(late.refunds).toEqual([
      expect.objectContaining({ amountPaise: PRICE, reason: 'HOLD_EXPIRED', status: 'pending' }),
    ]);
    expect(((await detail(h, a, plan.id)).body as EventDetail).viewer.rsvp).toBe('cancelled');
    await drain();
    const sent = [...gateway.refunds.entries()].find(([, r]) => r.amountPaise === PRICE);
    expect(sent).toBeDefined();
    const refundId = (await payment(a, held.session.paymentId)).refunds[0]?.id ?? '';
    const { rows } = await h.pool.query<{ provider_refund_id: string }>(
      'SELECT provider_refund_id FROM refunds WHERE id = $1',
      [refundId],
    );
    await deliver(gateway.simulateRefund('processed', rows[0]?.provider_refund_id ?? ''));
    const done = await payment(a, held.session.paymentId);
    expect(done).toMatchObject({ status: 'refunded', refundedPaise: PRICE });
    expect(done.refunds[0]?.status).toBe('processed');

    // B claims the offered spot by paying.
    const claim = (await checkout(b, plan.id, { fromOffer: true }).expect(201))
      .body as CheckoutResult;
    expect(claim.kind).toBe('checkout');
  });

  it('a second payment for the same plan (two tabs) is refunded automatically', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const buyer = await member(h);
    const first = (await checkout(buyer, plan.id).expect(201)).body as CheckoutResult;
    if (first.kind !== 'checkout') throw new Error('expected checkout');
    const firstOrder = await orderOf(first.session.paymentId);
    await request(h.http)
      .post(`/v1/payments/${first.session.paymentId}/cancel`)
      .set(...bearer(buyer.token))
      .expect(204);
    await buy(buyer, plan.id);
    await deliver(gateway.simulatePaymentCaptured(firstOrder));
    const dup = await payment(buyer, first.session.paymentId);
    expect(dup.refunds).toEqual([
      expect.objectContaining({ reason: 'DUPLICATE', amountPaise: PRICE }),
    ]);
    expect(((await detail(h, buyer, plan.id)).body as EventDetail).viewer.rsvp).toBe('going');
  });
});

// ---------- F-PAY-02 ----------

describe('refunds (F-PAY-02)', () => {
  it('attendee cancellations follow the policy at the time of cancelling', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host, {
      refundPolicy: { kind: 'partial', cutoffHours: 48, partialPct: 50 },
    });
    const [early, late] = [await member(h), await member(h)];
    const earlyPay = await buy(early, plan.id);
    const latePay = await buy(late, plan.id);

    const quote = (
      await request(h.http)
        .get(`/v1/events/${plan.id}/refund-quote`)
        .set(...bearer(early.token))
        .expect(200)
    ).body as RefundQuote;
    expect(quote).toMatchObject({
      paidPaise: PRICE,
      refundPaise: PRICE / 2,
      reason: 'BEFORE_CUTOFF',
    });
    await request(h.http)
      .delete(`/v1/events/${plan.id}/rsvp`)
      .set(...bearer(early.token))
      .expect(204);
    await drain();
    expect((await payment(early, earlyPay)).refunds).toEqual([
      expect.objectContaining({ amountPaise: PRICE / 2, reason: 'BEFORE_CUTOFF' }),
    ]);

    // Inside the cut-off nothing comes back.
    await shiftEvent(h, plan.id, 10 * 3_600_000);
    const lateQuote = (
      await request(h.http)
        .get(`/v1/events/${plan.id}/refund-quote`)
        .set(...bearer(late.token))
        .expect(200)
    ).body as RefundQuote;
    expect(lateQuote).toMatchObject({ refundPaise: 0, reason: 'AFTER_CUTOFF' });
    await request(h.http)
      .delete(`/v1/events/${plan.id}/rsvp`)
      .set(...bearer(late.token))
      .expect(204);
    await drain();
    expect((await payment(late, latePay)).refunds).toEqual([]);
  });

  it('host cancellation refunds every ticket in full and closes open checkouts', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host, { refundPolicy: { kind: 'none', cutoffHours: 0 } });
    const [a, b, c] = [await member(h), await member(h), await member(h)];
    const pa = await buy(a, plan.id);
    const pb = await buy(b, plan.id);
    const open = (await checkout(c, plan.id).expect(201)).body as CheckoutResult;
    if (open.kind !== 'checkout') throw new Error('expected checkout');
    await request(h.http)
      .post(`/v1/events/${plan.id}/cancel`)
      .set(...bearer(host.token))
      .set(...idem())
      .send({ reason: 'Rain' })
      .expect(200);
    await drain();
    for (const [m, id] of [
      [a, pa],
      [b, pb],
    ] as const)
      expect((await payment(m, id)).refunds).toEqual([
        expect.objectContaining({
          amountPaise: PRICE,
          reason: 'HOST_CANCELLED',
          status: 'processing',
        }),
      ]);
    expect((await payment(c, open.session.paymentId)).status).toBe('expired');
  });
});

// ---------- F-PAY-03 ----------

describe('platform fee, payouts and KYC (F-PAY-03)', () => {
  it('a completed plan becomes a payout, held until KYC, then sent per payment via Route', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const [a, b] = [await member(h), await member(h)];
    const pa = await buy(a, plan.id);
    await buy(b, plan.id);
    // A partial refund already went back before the plan.
    await h.pool.query(
      `UPDATE payments SET refunded_paise = 10000, status = 'partially_refunded' WHERE id = $1`,
      [pa],
    );
    await h.pool.query(
      `UPDATE events SET status = 'completed', starts_at = now() - interval '3 days', ends_at = now() - interval '2 days' WHERE id = $1`,
      [plan.id],
    );
    await h.app.get(EventStore).invalidate(plan.id);

    const payouts = h.app.get(PayoutsService);
    expect(await payouts.createDue()).toBeGreaterThanOrEqual(1);
    expect(await payouts.createDue()).toBe(0);
    const ledger = (
      await request(h.http)
        .get('/v1/host/payouts')
        .set(...bearer(host.token))
        .expect(200)
    ).body as PayoutLedger;
    const [p] = ledger.items;
    // Kept: 40 000 + 50 000 = 90 000; fee 10% = 9 000; GST 18% of fee = 1 620; host 79 380.
    expect(p).toMatchObject({
      eventId: plan.id,
      status: 'on_hold',
      holdReason: 'KYC_REQUIRED',
      grossPaise: 100_000,
      refundsPaise: 10_000,
      platformFeePaise: 9_000,
      gstPaise: 1_620,
      netPaise: 79_380,
    });
    expect(ledger.totals).toEqual({ paidPaise: 0, pendingPaise: 79_380 });

    const account = await request(h.http)
      .post('/v1/host/account')
      .set(...bearer(host.token))
      .set(...idem())
      .send({ legalBusinessName: 'Ravi Rides', contactName: 'Ravi K', email: 'ravi@example.com' })
      .expect(201);
    expect(account.body.status).toBe('created');
    const { rows } = await h.pool.query<{ provider_account_id: string }>(
      'SELECT provider_account_id FROM host_accounts WHERE user_id = $1',
      [host.id],
    );
    const accountId = rows[0]?.provider_account_id ?? '';
    await deliver(gateway.simulateAccount('activated', accountId));
    expect(
      (
        (
          await request(h.http)
            .get('/v1/host/status')
            .set(...bearer(host.token))
        ).body as HostStatus
      ).account?.status,
    ).toBe('activated');

    await payouts.executeDue();
    const transfers = [...gateway.transfers.entries()].filter(
      ([, t]) => t.providerAccountId === accountId,
    );
    expect(transfers.map(([, t]) => t.amountPaise).sort((x, y) => x - y)).toEqual([35_280, 44_100]);
    for (const [id] of transfers) await deliver(gateway.simulateTransfer('processed', id));
    const paid = (
      await request(h.http)
        .get('/v1/host/payouts')
        .set(...bearer(host.token))
        .expect(200)
    ).body as PayoutLedger;
    expect(paid.items[0]?.status).toBe('paid');
    expect(paid.totals).toEqual({ paidPaise: 79_380, pendingPaise: 0 });
  });

  it('admins see the money overview; others cannot', async () => {
    const overview = (
      await request(h.http)
        .get('/v1/admin/payments')
        .set(...bearer(admin.token))
        .expect(200)
    ).body as AdminPaymentsOverview;
    expect(overview.totals.capturedPaise).toBeGreaterThan(0);
    expect(overview.payments.length).toBeGreaterThan(0);
    expect(overview.refunds.length).toBeGreaterThan(0);
    expect(overview.payouts.length).toBeGreaterThan(0);
    const someone = await member(h);
    await request(h.http)
      .get('/v1/admin/payments')
      .set(...bearer(someone.token))
      .expect(403);
  });
});

// ---------- F-PAY-04 ----------

describe('venue partnerships and perks (F-PAY-04)', () => {
  async function partnerVenue(pin: string): Promise<string> {
    const { cityId } = await cityAndHood(h);
    const { rows } = await h.pool.query<{ id: string }>(
      `INSERT INTO venues (city_id, name, address, location) VALUES ($1, $2, 'Road 36, Jubilee Hills',
        ST_GeogFromText('POINT(78.4075 17.4300)')) RETURNING id`,
      [cityId, `Chai Point ${String(Date.now())}`],
    );
    const id = rows[0]?.id ?? '';
    await request(h.http)
      .put(`/v1/admin/venues/${id}/partner`)
      .set(...bearer(admin.token))
      .send({ isPartner: true, description: 'Chai and snacks', staffPin: pin })
      .expect(204);
    await request(h.http)
      .post(`/v1/admin/venues/${id}/perks`)
      .set(...bearer(admin.token))
      .send({ title: '10% off for groups of 2+', minGroupSize: 2 })
      .expect(201);
    return id;
  }

  it('perks show on plans at partner venues and are redeemed once with the staff PIN', async () => {
    const venueId = await partnerVenue('4321');
    const host = await verifiedMember(h);
    const plan = await plot(h, host, { where: { venueId } });
    const guest = await member(h);
    await rsvp(h, guest, plan.id).expect(200);
    const outsider = await member(h);

    const early = (await detail(h, guest, plan.id)).body as EventDetail;
    expect(early.perks).toHaveLength(1);
    expect(early.perks[0]).toMatchObject({ canRedeem: false, reason: 'NOT_TODAY' });

    await shiftEvent(h, plan.id, 30 * 60_000);
    const today = (await detail(h, guest, plan.id)).body as EventDetail;
    expect(today.perks[0]?.canRedeem).toBe(true);
    const perkId = today.perks[0]?.perk.id ?? '';
    const notGoing = await request(h.http)
      .post(`/v1/events/${plan.id}/perks/${perkId}/pass`)
      .set(...bearer(outsider.token));
    expect(notGoing.status).toBe(409);
    expect(notGoing.body.error.details.reason).toBe('NOT_GOING');

    const pass = (
      await request(h.http)
        .post(`/v1/events/${plan.id}/perks/${perkId}/pass`)
        .set(...bearer(guest.token))
        .expect(201)
    ).body as PerkPass;
    expect(pass.code).toMatch(/^[A-Z2-9]{6}$/);
    const token = pass.qr.split('/r/')[1] ?? '';
    const preview = (
      await request(h.http)
        .get(`/v1/perk-passes/${token}`)
        .set(...fromIp())
        .expect(200)
    ).body as PerkPassPreview;
    expect(preview).toMatchObject({ groupSize: 2, redeemedAt: null });
    expect(preview.firstName).not.toContain(' ');

    const wrong = await request(h.http)
      .post('/v1/perk-passes/redeem')
      .set(...fromIp())
      .send({ token, pin: '0000' });
    expect(wrong.body.error.details.reason).toBe('WRONG_PIN');
    const ok = (
      await request(h.http)
        .post('/v1/perk-passes/redeem')
        .set(...fromIp())
        .send({ token, pin: '4321' })
        .expect(200)
    ).body as PerkPassPreview;
    expect(ok.redeemedAt).not.toBeNull();
    const twice = await request(h.http)
      .post('/v1/perk-passes/redeem')
      .set(...fromIp())
      .send({ code: pass.code, venueId, pin: '4321' });
    expect(twice.body.error.details.reason).toBe('ALREADY_REDEEMED');
    expect(
      ((await detail(h, guest, plan.id)).body as EventDetail).perks[0]?.redeemedAt,
    ).not.toBeNull();

    const venues = await request(h.http)
      .get('/v1/admin/venues')
      .query({ partner: 'partners', q: 'Chai Point' })
      .set(...bearer(admin.token))
      .expect(200);
    expect(venues.body.items.find((v: { id: string }) => v.id === venueId)).toMatchObject({
      isPartner: true,
      hasStaffPin: true,
      redemptions: 1,
    });
  });

  it('wrong PINs lock the venue for an hour, across IPs', async () => {
    const venueId = await partnerVenue('9876');
    const host = await verifiedMember(h);
    const plan = await plot(h, host, { where: { venueId } });
    const guest = await member(h);
    await rsvp(h, guest, plan.id).expect(200);
    await shiftEvent(h, plan.id, 30 * 60_000);
    const perkId = ((await detail(h, guest, plan.id)).body as EventDetail).perks[0]?.perk.id ?? '';
    const pass = (
      await request(h.http)
        .post(`/v1/events/${plan.id}/perks/${perkId}/pass`)
        .set(...bearer(guest.token))
        .expect(201)
    ).body as PerkPass;
    for (let i = 0; i < 10; i += 1)
      await request(h.http)
        .post('/v1/perk-passes/redeem')
        .set(...fromIp())
        .send({ code: pass.code, venueId, pin: String(1000 + i) });
    const locked = await request(h.http)
      .post('/v1/perk-passes/redeem')
      .set(...fromIp())
      .send({ code: pass.code, venueId, pin: '9876' });
    expect(locked.status).toBe(429);
  });
});

// ---------- F-HST-02 ----------

describe('host analytics (F-HST-02)', () => {
  it('counts distinct daily viewers, RSVPs, conversion and revenue for the host only', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const [a, b] = [await member(h), await member(h)];
    await detail(h, a, plan.id).expect(200);
    await detail(h, a, plan.id).expect(200);
    await detail(h, b, plan.id).expect(200);
    await detail(h, host, plan.id).expect(200);
    await buy(a, plan.id);

    const one = (
      await request(h.http)
        .get(`/v1/host/analytics/events/${plan.id}`)
        .set(...bearer(host.token))
        .expect(200)
    ).body as EventAnalytics;
    expect(one).toMatchObject({
      views: 2,
      rsvps: 1,
      conversionPct: 50,
      revenuePaise: PRICE,
      averageRating: null,
      ratingsCount: 0,
    });
    const all = (
      await request(h.http)
        .get('/v1/host/analytics')
        .set(...bearer(host.token))
        .expect(200)
    ).body as HostAnalytics;
    expect(all.totals).toMatchObject({ events: 1, views: 2, rsvps: 1, revenuePaise: PRICE });
    await request(h.http)
      .get(`/v1/host/analytics/events/${plan.id}`)
      .set(...bearer(a.token))
      .expect(403);
  });
});

describe('account data', () => {
  it('payments are part of the data export', async () => {
    const host = await approvedHost();
    const plan = await paidPlan(host);
    const buyer = await member(h);
    const id = await buy(buyer, plan.id);
    const exported = await request(h.http)
      .get('/v1/me/export')
      .set(...bearer(buyer.token))
      .expect(200);
    expect(JSON.stringify(exported.body)).toContain(id);
  });
});
