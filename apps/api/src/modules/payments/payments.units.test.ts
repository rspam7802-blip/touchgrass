import type { EventAnalytics, Receipt } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import { FAKE_WEBHOOK_SECRET, FakePaymentsGateway } from '../../adapters/payments/fake.payments.js';
import { hmacSha256Hex, parseRazorpayWebhook } from '../../adapters/payments/payments.port.js';
import { conversionPct, summarise } from '../hosting/host-analytics.service.js';
import { hostingRights } from '../hosting/hosting.service.js';
import { istDayStart, perkBlock } from '../perks/perks.service.js';
import { payoutLedger } from './payouts.service.js';
import { receiptEmail } from './receipt-email.js';

const H = 3_600_000;

describe('payout ledger (F-PAY-03)', () => {
  it('applies each payment’s own fee rate to what was kept, and only transfers positive shares', () => {
    const l = payoutLedger([
      {
        paymentId: 'a',
        providerPaymentId: 'pay_a',
        amountPaise: 50_000,
        refundedPaise: 10_000,
        feeBps: 1000,
      },
      {
        paymentId: 'b',
        providerPaymentId: 'pay_b',
        amountPaise: 50_000,
        refundedPaise: 0,
        feeBps: 500,
      },
      {
        paymentId: 'c',
        providerPaymentId: 'pay_c',
        amountPaise: 50_000,
        refundedPaise: 50_000,
        feeBps: 1000,
      },
    ]);
    expect(l).toEqual({
      gross: 150_000,
      refunds: 60_000,
      fee: 4_000 + 2_500,
      gst: 720 + 450,
      net: 35_280 + 47_050,
      transfers: [
        { paymentId: 'a', amountPaise: 35_280 },
        { paymentId: 'b', amountPaise: 47_050 },
      ],
    });
    expect(payoutLedger([])).toEqual({
      gross: 0,
      refunds: 0,
      fee: 0,
      gst: 0,
      net: 0,
      transfers: [],
    });
  });
});

describe('hosting rights (F-HST-01)', () => {
  it('free needs verification (when required); paid also needs an approved application', () => {
    expect(hostingRights(false, true, null)).toEqual({ canHostFree: false, canHostPaid: false });
    expect(hostingRights(false, false, null)).toEqual({ canHostFree: true, canHostPaid: false });
    expect(hostingRights(true, true, { status: 'pending' })).toEqual({
      canHostFree: true,
      canHostPaid: false,
    });
    expect(hostingRights(true, true, { status: 'approved' })).toEqual({
      canHostFree: true,
      canHostPaid: true,
    });
    expect(hostingRights(false, true, { status: 'approved' }).canHostPaid).toBe(false);
    // Free plans only (D-165): even approved hosts can't sell.
    expect(hostingRights(true, true, { status: 'approved' }, false)).toEqual({
      canHostFree: true,
      canHostPaid: false,
    });
  });
});

describe('host analytics maths (F-HST-02)', () => {
  const e = (over: Partial<EventAnalytics>): EventAnalytics => ({
    eventId: 'e',
    title: 't',
    startsAt: '2026-11-01T10:00:00.000Z',
    status: 'completed',
    views: 0,
    rsvps: 0,
    conversionPct: 0,
    checkIns: 0,
    noShows: 0,
    repeatAttendees: 0,
    averageRating: null,
    ratingsCount: 0,
    themes: [],
    revenuePaise: 0,
    ...over,
  });
  it('conversion is RSVPs per 100 views, one decimal, 0 without views', () => {
    expect(conversionPct(1, 3)).toBe(33.3);
    expect(conversionPct(5, 0)).toBe(0);
  });
  it('totals weight ratings by count and merge themes', () => {
    const t = summarise([
      e({
        views: 10,
        rsvps: 5,
        averageRating: 4,
        ratingsCount: 1,
        themes: [{ theme: 'fun', count: 2 }],
        revenuePaise: 100,
      }),
      e({
        views: 10,
        rsvps: 1,
        averageRating: 5,
        ratingsCount: 3,
        themes: [
          { theme: 'fun', count: 1 },
          { theme: 'late', count: 3 },
        ],
        revenuePaise: 50,
      }),
      e({}),
    ]);
    expect(t).toMatchObject({
      events: 3,
      views: 20,
      rsvps: 6,
      conversionPct: 30,
      averageRating: 4.8,
      ratingsCount: 4,
      revenuePaise: 150,
    });
    expect(t.themes).toEqual([
      { theme: 'fun', count: 3 },
      { theme: 'late', count: 3 },
    ]);
    expect(summarise([]).averageRating).toBeNull();
  });
});

describe('perk eligibility (F-PAY-04)', () => {
  const start = new Date('2026-11-07T12:30:00.000Z'); // 18:00 IST
  const event = { status: 'published', startsAt: start, endsAt: new Date(start.getTime() + 2 * H) };
  const perk = { active: true, validUntil: null, minGroupSize: 4 };
  it('the plan’s day starts at midnight IST', () => {
    expect(istDayStart(start).toISOString()).toBe('2026-11-06T18:30:00.000Z');
  });
  it('needs a seat, a big enough group, the right day and a live perk', () => {
    const today = new Date('2026-11-07T06:00:00.000Z');
    expect(perkBlock(perk, event, true, 4, today)).toBeNull();
    expect(perkBlock(perk, event, false, 4, today)).toBe('NOT_GOING');
    expect(perkBlock(perk, event, true, 3, today)).toBe('GROUP_TOO_SMALL');
    expect(perkBlock(perk, event, true, 4, new Date('2026-11-06T18:00:00.000Z'))).toBe('NOT_TODAY');
    expect(perkBlock(perk, event, true, 4, new Date(start.getTime() + 9 * H))).toBe('NOT_TODAY');
    expect(perkBlock({ ...perk, active: false }, event, true, 4, today)).toBe('PERK_EXPIRED');
    expect(
      perkBlock({ ...perk, validUntil: new Date('2026-11-01T00:00:00Z') }, event, true, 4, today),
    ).toBe('PERK_EXPIRED');
    expect(perkBlock(perk, { ...event, status: 'cancelled' }, true, 4, today)).toBe('CLOSED');
  });
});

describe('receipt email (F-PAY-05)', () => {
  const r: Receipt = {
    number: 'TG-2026-000042',
    paymentId: '0192f3a4-5b6c-7d8e-9f01-000000000001',
    issuedAt: '2026-11-01T10:00:00.000Z',
    buyerName: 'Priya',
    event: {
      id: '0192f3a4-5b6c-7d8e-9f01-000000000002',
      title: 'Chai <&> chess',
      startsAt: '2026-11-07T12:30:00.000Z',
    },
    hostName: 'Ravi',
    amountPaise: 50_000,
    method: 'upi',
    platformFeePaise: 5_000,
    gstPaise: 900,
    refunds: [],
    netPaidPaise: 25_000,
    sellerName: 'TouchGrass',
    sellerGstin: '36ABCDE1234F1Z5',
  };
  it('renders text and escaped HTML in the buyer’s language', () => {
    const en = receiptEmail('p@example.com', r, 'en');
    expect(en.subject).toBe('TouchGrass · Receipt TG-2026-000042');
    expect(en.text).toContain('Refunded: − ₹250');
    expect(en.text).toContain('UPI');
    expect(en.html).toContain('Chai &lt;&amp;&gt; chess');
    expect(en.html).not.toContain('<&>');
    expect(en.html).toContain('GSTIN 36ABCDE1234F1Z5');
    const te = receiptEmail(
      'p@example.com',
      { ...r, method: null, sellerGstin: null, netPaidPaise: 50_000 },
      'te',
    );
    expect(te.html).toContain('lang="te"');
    expect(te.text).not.toContain('UPI');
    expect(te.text).not.toContain('−');
  });
});

describe('Razorpay webhooks (adapter)', () => {
  it('parses account, transfer and payment-method fields; signatures are HMAC-SHA256 of the raw body', () => {
    const fake = new FakePaymentsGateway();
    const w = fake.simulateAccount('needs_clarification', 'acc_1');
    expect(parseRazorpayWebhook(w.rawBody)).toMatchObject({
      type: 'account.needs_clarification',
      providerAccountId: 'acc_1',
    });
    expect(w.signature).toBe(hmacSha256Hex(FAKE_WEBHOOK_SECRET, w.rawBody));
    expect(fake.verifyWebhookSignature(w.rawBody, w.signature)).toBe(true);
    expect(fake.verifyWebhookSignature(`${w.rawBody} `, w.signature)).toBe(false);
    expect(
      parseRazorpayWebhook(fake.simulateTransfer('failed', 'trf_1', 100).rawBody),
    ).toMatchObject({
      type: 'transfer.failed',
      providerTransferId: 'trf_1',
      amountPaise: 100,
    });
    expect(
      parseRazorpayWebhook(fake.simulatePaymentCaptured('order_x', 999, 'card').rawBody),
    ).toMatchObject({
      type: 'payment.captured',
      providerOrderId: 'order_x',
      amountPaise: 999,
      method: 'card',
    });
    expect(() => fake.simulatePaymentFailed('order_unknown')).toThrow();
    expect(() => fake.simulateRefund('processed', 'rfnd_unknown')).toThrow();
    expect(() => fake.simulateTransfer('processed', 'trf_unknown')).toThrow();
  });

  it('settles refunds, transfers and accounts by itself only when a hook is set', async () => {
    const fake = new FakePaymentsGateway();
    const seen: string[] = [];
    await fake.refund({ providerPaymentId: 'pay_1', amountPaise: 100 });
    fake.onSettle = (w) => {
      seen.push(parseRazorpayWebhook(w.rawBody).type);
    };
    await fake.refund({ providerPaymentId: 'pay_1', amountPaise: 100 });
    await fake.transfer({ providerPaymentId: 'pay_1', providerAccountId: 'acc', amountPaise: 50 });
    await fake.createLinkedAccount({
      referenceId: 'r',
      email: 'e@example.com',
      phoneE164: '+919000000000',
      legalBusinessName: 'L',
      contactName: 'C',
    });
    await new Promise((r) => setTimeout(r, 120));
    expect(seen.sort()).toEqual(['account.activated', 'refund.processed', 'transfer.processed']);
  });
});
