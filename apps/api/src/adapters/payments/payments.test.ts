import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonBody } from '../../test-support/env.js';
import { FAKE_WEBHOOK_SECRET, FakePaymentsGateway } from './fake.payments.js';
import { constantTimeEqualHex, hmacSha256Hex, parseRazorpayWebhook } from './payments.port.js';
import { RazorpayPaymentsGateway } from './razorpay.payments.js';

const config = { keyId: 'rzp_test_1', keySecret: 'secret', webhookSecret: 'whsec' };

describe('RazorpayPaymentsGateway', () => {
  it('creates orders with basic auth and INR paise', async () => {
    const f = fakeFetch([{ body: { id: 'order_1', amount: 49900 } }]);
    const gw = new RazorpayPaymentsGateway(config, f.fetch);
    await expect(
      gw.createOrder({
        amountPaise: 49900,
        receipt: 'pay_'.padEnd(60, 'x'),
        notes: { eventId: 'e' },
      }),
    ).resolves.toEqual({
      providerOrderId: 'order_1',
      amountPaise: 49900,
      currency: 'INR',
    });
    const body = jsonBody(f.calls[0]?.init) as { receipt: string; currency: string };
    expect(body.receipt).toHaveLength(40);
    expect(body.currency).toBe('INR');
    expect((f.calls[0]?.init?.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('rzp_test_1:secret').toString('base64')}`,
    );
    expect(gw.publicKeyId).toBe('rzp_test_1');
  });
  it('creates payment links, refunds, linked accounts and transfers', async () => {
    const f = fakeFetch([
      { body: { id: 'plink_1', short_url: 'https://rzp.io/i/x' } },
      { body: { id: 'rfnd_1', status: 'processed' } },
      { body: { id: 'rfnd_2', status: 'failed' } },
      { body: { id: 'rfnd_3', status: 'pending' } },
      { body: { id: 'acc_1' } },
      { body: { items: [{ id: 'trf_1' }] } },
      { body: { items: [] } },
    ]);
    const gw = new RazorpayPaymentsGateway(config, f.fetch);
    await expect(
      gw.createPaymentLink({
        amountPaise: 100,
        referenceId: 'r',
        description: 'd',
        customerPhoneE164: '+919848022338',
        callbackUrl: 'https://x',
        expireBy: new Date(1_800_000_000_000),
      }),
    ).resolves.toEqual({ providerLinkId: 'plink_1', shortUrl: 'https://rzp.io/i/x' });
    await expect(gw.refund({ providerPaymentId: 'pay_1', amountPaise: 100 })).resolves.toEqual({
      providerRefundId: 'rfnd_1',
      status: 'processed',
    });
    await expect(
      gw.refund({ providerPaymentId: 'pay_1', amountPaise: 100 }),
    ).resolves.toMatchObject({ status: 'failed' });
    await expect(
      gw.refund({ providerPaymentId: 'pay_1', amountPaise: 100 }),
    ).resolves.toMatchObject({ status: 'pending' });
    await expect(
      gw.createLinkedAccount({
        referenceId: 'host_1',
        email: 'h@x.in',
        phoneE164: '+919848022338',
        legalBusinessName: 'H',
        contactName: 'H',
      }),
    ).resolves.toEqual({ providerAccountId: 'acc_1' });
    expect((jsonBody(f.calls[4]?.init) as { phone: string }).phone).toBe('9848022338');
    await expect(
      gw.transfer({ providerPaymentId: 'pay_1', providerAccountId: 'acc_1', amountPaise: 90 }),
    ).resolves.toEqual({ providerTransferId: 'trf_1' });
    expect(f.calls[5]?.url).toContain('/v1/payments/pay_1/transfers');
    await expect(
      gw.transfer({ providerPaymentId: 'pay_1', providerAccountId: 'acc_1', amountPaise: 90 }),
    ).rejects.toThrow(/no transfer/);
  });
  it('verifies webhook signatures in constant time', () => {
    const gw = new RazorpayPaymentsGateway(config, fakeFetch([]).fetch);
    const body = '{"event":"payment.captured"}';
    expect(gw.verifyWebhookSignature(body, hmacSha256Hex('whsec', body))).toBe(true);
    expect(gw.verifyWebhookSignature(body, hmacSha256Hex('other', body))).toBe(false);
    expect(gw.verifyWebhookSignature(body, 'not-hex')).toBe(false);
    expect(gw.parseWebhook(body).type).toBe('payment.captured');
  });
});

describe('webhook parsing', () => {
  it('normalises payment, refund, transfer and unknown events', () => {
    expect(
      parseRazorpayWebhook(
        JSON.stringify({
          event: 'payment.captured',
          payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 100 } } },
        }),
      ),
    ).toEqual({
      type: 'payment.captured',
      rawType: 'payment.captured',
      providerPaymentId: 'pay_1',
      providerOrderId: 'order_1',
      providerRefundId: undefined,
      providerTransferId: undefined,
      providerAccountId: undefined,
      amountPaise: 100,
    });
    expect(
      parseRazorpayWebhook(
        JSON.stringify({
          event: 'refund.processed',
          payload: { refund: { entity: { id: 'r', payment_id: 'p', amount: 5 } } },
        }),
      ),
    ).toMatchObject({
      providerPaymentId: 'p',
      providerRefundId: 'r',
      amountPaise: 5,
    });
    expect(
      parseRazorpayWebhook(
        JSON.stringify({
          event: 'transfer.processed',
          payload: { transfer: { entity: { id: 't', amount: 7 } } },
        }),
      ),
    ).toMatchObject({ providerTransferId: 't', amountPaise: 7 });
    expect(
      parseRazorpayWebhook(
        JSON.stringify({
          event: 'order.paid',
          payload: { order: { entity: { id: 'o', amount: 9 } } },
        }),
      ),
    ).toMatchObject({ providerOrderId: 'o', amountPaise: 9 });
    expect(
      parseRazorpayWebhook(
        JSON.stringify({
          event: 'account.activated',
          payload: { account: { entity: { id: 'acc' } } },
        }),
      ),
    ).toMatchObject({ providerAccountId: 'acc' });
    expect(parseRazorpayWebhook('{"event":"virtual_account.created"}').type).toBe('unknown');
    expect(parseRazorpayWebhook('{}').rawType).toBe('unknown');
  });
  it('compares hex safely', () => {
    expect(constantTimeEqualHex('ab', 'ab')).toBe(true);
    expect(constantTimeEqualHex('ab', 'abcd')).toBe(false);
  });
});

describe('FakePaymentsGateway', () => {
  it('simulates signed capture, failure and refund webhooks', async () => {
    const gw = new FakePaymentsGateway();
    const order = await gw.createOrder({ amountPaise: 29900, receipt: 'r1' });
    const captured = gw.simulatePaymentCaptured(order.providerOrderId);
    expect(gw.verifyWebhookSignature(captured.rawBody, captured.signature)).toBe(true);
    expect(
      gw.verifyWebhookSignature(
        captured.rawBody,
        hmacSha256Hex(`${FAKE_WEBHOOK_SECRET}x`, captured.rawBody),
      ),
    ).toBe(false);
    const event = gw.parseWebhook(captured.rawBody);
    expect(event).toMatchObject({
      type: 'payment.captured',
      providerOrderId: order.providerOrderId,
      amountPaise: 29900,
    });
    expect(gw.simulatePaymentCaptured(order.providerOrderId).rawBody).toContain(
      event.providerPaymentId ?? 'missing',
    );
    expect(gw.parseWebhook(gw.simulatePaymentFailed(order.providerOrderId).rawBody).type).toBe(
      'payment.failed',
    );
    const refund = await gw.refund({
      providerPaymentId: event.providerPaymentId ?? '',
      amountPaise: 29900,
    });
    expect(
      gw.parseWebhook(gw.simulateRefundProcessed(refund.providerRefundId).rawBody),
    ).toMatchObject({ type: 'refund.processed', amountPaise: 29900 });
  });
  it('supports links, accounts, transfers and rejects unknown ids', async () => {
    const gw = new FakePaymentsGateway();
    expect(
      (
        await gw.createPaymentLink({
          amountPaise: 1,
          referenceId: 'r',
          description: 'd',
          callbackUrl: 'https://x',
        })
      ).shortUrl,
    ).toMatch(/^https:\/\/rzp.io/);
    expect(
      (
        await gw.createLinkedAccount({
          referenceId: 'h',
          email: 'e@x.in',
          phoneE164: '+919848022338',
          legalBusinessName: 'x',
          contactName: 'x',
        })
      ).providerAccountId,
    ).toMatch(/^acc_/);
    expect(
      (await gw.transfer({ providerPaymentId: 'p', providerAccountId: 'a', amountPaise: 1 }))
        .providerTransferId,
    ).toMatch(/^trf_/);
    expect(() => gw.simulatePaymentCaptured('nope')).toThrow();
    expect(() => gw.simulatePaymentFailed('nope')).toThrow();
    expect(() => gw.simulateRefundProcessed('nope')).toThrow();
  });
});
