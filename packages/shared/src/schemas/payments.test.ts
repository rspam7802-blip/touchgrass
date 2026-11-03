import { describe, expect, it } from 'vitest';
import {
  CheckoutBody,
  CreateHostApplicationBody,
  DEFAULT_REFUND_POLICY,
  feeBreakdown,
  RedeemPerkBody,
  RefundPolicy,
  refundFor,
  UpdateVenuePartnerBody,
  UpsertPerkBody,
} from './payments';

const START = new Date('2026-11-07T12:30:00.000Z');
const H = 3_600_000;

describe('refund policy (F-PAY-02)', () => {
  it('full refunds before the cut-off, nothing after', () => {
    const p = DEFAULT_REFUND_POLICY;
    expect(refundFor(p, 50_000, START, new Date(START.getTime() - 25 * H))).toEqual({
      refundPaise: 50_000,
      reason: 'BEFORE_CUTOFF',
    });
    expect(refundFor(p, 50_000, START, new Date(START.getTime() - 24 * H))).toEqual({
      refundPaise: 50_000,
      reason: 'BEFORE_CUTOFF',
    });
    expect(refundFor(p, 50_000, START, new Date(START.getTime() - 23 * H))).toEqual({
      refundPaise: 0,
      reason: 'AFTER_CUTOFF',
    });
  });

  it('partial refunds round to whole paise; none never refunds', () => {
    const partial = RefundPolicy.parse({ kind: 'partial', cutoffHours: 48, partialPct: 50 });
    expect(refundFor(partial, 49_999, START, new Date(START.getTime() - 72 * H)).refundPaise).toBe(
      25_000,
    );
    const none = RefundPolicy.parse({ kind: 'none', cutoffHours: 0 });
    expect(refundFor(none, 49_999, START, new Date(START.getTime() - 72 * H))).toEqual({
      refundPaise: 0,
      reason: 'NO_REFUNDS',
    });
  });

  it('partial policies need a percentage; cut-offs are bounded', () => {
    expect(RefundPolicy.safeParse({ kind: 'partial', cutoffHours: 24 }).success).toBe(false);
    expect(RefundPolicy.safeParse({ kind: 'full', cutoffHours: 169 }).success).toBe(false);
  });
});

describe('platform fee and GST (F-PAY-03)', () => {
  it('takes the fee, GST on the fee, and leaves the rest for the host', () => {
    expect(feeBreakdown(100_000, 1000)).toEqual({
      grossPaise: 100_000,
      platformFeePaise: 10_000,
      gstPaise: 1_800,
      hostNetPaise: 88_200,
    });
    expect(feeBreakdown(0, 1000).hostNetPaise).toBe(0);
    expect(feeBreakdown(999, 1000, 0)).toEqual({
      grossPaise: 999,
      platformFeePaise: 100,
      gstPaise: 0,
      hostNetPaise: 899,
    });
  });
});

describe('payments request schemas', () => {
  it('checkout defaults and email validation', () => {
    expect(CheckoutBody.parse({})).toEqual({
      receiptEmail: null,
      fromOffer: false,
      useCredit: false,
    });
    expect(CheckoutBody.safeParse({ receiptEmail: 'not-an-email' }).success).toBe(false);
  });

  it('host applications need real answers', () => {
    const ok = {
      about: 'I run a Sunday cycling group in Gachibowli.',
      experience: 'Hosted 30 rides for groups of 10 to 40 people.',
      eventIdeas: 'Sunrise rides with breakfast at a partner cafe.',
    };
    expect(CreateHostApplicationBody.parse(ok).links).toEqual([]);
    expect(CreateHostApplicationBody.safeParse({ ...ok, about: 'hi' }).success).toBe(false);
    expect(CreateHostApplicationBody.safeParse({ ...ok, links: ['nope'] }).success).toBe(false);
  });

  it('perk redemption takes a scanned token or a typed code with its venue, plus a PIN', () => {
    expect(RedeemPerkBody.safeParse({ token: 'x'.repeat(30), pin: '1234' }).success).toBe(true);
    expect(
      RedeemPerkBody.parse({
        code: 'ab3c4d',
        venueId: '0192f3a4-5b6c-7d8e-9f01-000000000001',
        pin: '123456',
      }).code,
    ).toBe('AB3C4D');
    expect(RedeemPerkBody.safeParse({ code: 'AB3C4D', pin: '1234' }).success).toBe(false);
    expect(RedeemPerkBody.safeParse({ token: 'x'.repeat(30), pin: '12' }).success).toBe(false);
  });

  it('admin venue and perk payloads', () => {
    expect(UpdateVenuePartnerBody.parse({ isPartner: true })).toEqual({
      isPartner: true,
      description: '',
    });
    expect(UpdateVenuePartnerBody.safeParse({ isPartner: true, staffPin: '12a4' }).success).toBe(
      false,
    );
    expect(UpsertPerkBody.parse({ title: '10% off' })).toEqual({
      title: '10% off',
      description: '',
      minGroupSize: 1,
      validUntil: null,
      active: true,
    });
  });
});
