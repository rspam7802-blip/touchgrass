import { randomBytes } from 'node:crypto';
import {
  constantTimeEqualHex,
  type CreateOrderInput,
  type CreatePaymentLinkInput,
  hmacSha256Hex,
  type LinkedAccountInput,
  parseRazorpayWebhook,
  type PaymentWebhookEvent,
  PaymentsGateway,
  type ProviderOrder,
  type ProviderPaymentLink,
  type ProviderRefund,
  type RefundInput,
  type DirectTransferInput,
  type TransferInput,
} from './payments.port.js';

export const FAKE_WEBHOOK_SECRET = 'fake-razorpay-webhook-secret';

export interface SimulatedWebhook {
  eventId: string;
  rawBody: string;
  signature: string;
}

const id = (prefix: string): string => `${prefix}_fake${randomBytes(7).toString('hex')}`;

/**
 * In-memory gateway that mirrors Razorpay's shapes. `simulate*` methods produce correctly signed
 * webhook deliveries so the real webhook pipeline (signature check → queue → state machine) is exercised.
 */
export class FakePaymentsGateway extends PaymentsGateway {
  readonly publicKeyId = 'rzp_test_fake';
  readonly orders = new Map<string, { amountPaise: number; receipt: string; paymentId?: string }>();
  readonly refunds = new Map<string, RefundInput>();
  readonly transfers = new Map<string, TransferInput | DirectTransferInput>();
  readonly accounts = new Map<string, LinkedAccountInput>();
  readonly links = new Map<string, CreatePaymentLinkInput>();

  createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const orderId = id('order');
    this.orders.set(orderId, { amountPaise: input.amountPaise, receipt: input.receipt });
    return Promise.resolve({
      providerOrderId: orderId,
      amountPaise: input.amountPaise,
      currency: 'INR',
    });
  }

  createPaymentLink(input: CreatePaymentLinkInput): Promise<ProviderPaymentLink> {
    const linkId = id('plink');
    this.links.set(linkId, input);
    return Promise.resolve({ providerLinkId: linkId, shortUrl: `https://rzp.io/fake/${linkId}` });
  }

  refund(input: RefundInput): Promise<ProviderRefund> {
    const refundId = id('rfnd');
    this.refunds.set(refundId, input);
    this.settleLater(() => this.simulateRefund('processed', refundId));
    return Promise.resolve({ providerRefundId: refundId, status: 'pending' });
  }

  createLinkedAccount(input: LinkedAccountInput): Promise<{ providerAccountId: string }> {
    const accountId = id('acc');
    this.accounts.set(accountId, input);
    this.settleLater(() => this.simulateAccount('activated', accountId));
    return Promise.resolve({ providerAccountId: accountId });
  }

  transfer(input: TransferInput): Promise<{ providerTransferId: string }> {
    const transferId = id('trf');
    this.transfers.set(transferId, input);
    this.settleLater(() => this.simulateTransfer('processed', transferId));
    return Promise.resolve({ providerTransferId: transferId });
  }

  directTransfer(input: DirectTransferInput): Promise<{ providerTransferId: string }> {
    const transferId = id('trf');
    this.transfers.set(transferId, input);
    this.settleLater(() => this.simulateTransfer('processed', transferId));
    return Promise.resolve({ providerTransferId: transferId });
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    return constantTimeEqualHex(hmacSha256Hex(FAKE_WEBHOOK_SECRET, rawBody), signature);
  }

  parseWebhook(rawBody: string): PaymentWebhookEvent {
    return parseRazorpayWebhook(rawBody);
  }

  /**
   * Local development: when set, refunds, transfers and linked accounts settle on their own (the hook receives a
   * signed webhook to feed through the normal pipeline). Payments never settle by themselves: someone has to
   * press "pay" on the checkout page.
   */
  onSettle: ((webhook: SimulatedWebhook) => void) | null = null;

  private settleLater(webhook: () => SimulatedWebhook): void {
    const hook = this.onSettle;
    if (hook)
      setTimeout(() => {
        hook(webhook());
      }, 50);
  }

  simulatePaymentCaptured(
    providerOrderId: string,
    amountPaise?: number,
    method: string = 'upi',
  ): SimulatedWebhook {
    const order = this.orders.get(providerOrderId);
    const amount = amountPaise ?? order?.amountPaise;
    if (amount === undefined) throw new Error(`Unknown fake order ${providerOrderId}`);
    const paymentId = order ? (order.paymentId ??= id('pay')) : id('pay');
    return this.sign('payment.captured', {
      payment: {
        entity: {
          id: paymentId,
          order_id: providerOrderId,
          amount,
          method,
          status: 'captured',
        },
      },
    });
  }

  simulatePaymentFailed(providerOrderId: string, amountPaise?: number): SimulatedWebhook {
    const amount = amountPaise ?? this.orders.get(providerOrderId)?.amountPaise;
    if (amount === undefined) throw new Error(`Unknown fake order ${providerOrderId}`);
    return this.sign('payment.failed', {
      payment: {
        entity: { id: id('pay'), order_id: providerOrderId, amount, status: 'failed' },
      },
    });
  }

  simulateRefund(
    outcome: 'processed' | 'failed',
    providerRefundId: string,
    providerPaymentId?: string,
    amountPaise?: number,
  ): SimulatedWebhook {
    const known = this.refunds.get(providerRefundId);
    const paymentId = providerPaymentId ?? known?.providerPaymentId;
    const amount = amountPaise ?? known?.amountPaise;
    if (!paymentId || amount === undefined)
      throw new Error(`Unknown fake refund ${providerRefundId}`);
    return this.sign(`refund.${outcome}`, {
      refund: { entity: { id: providerRefundId, payment_id: paymentId, amount, status: outcome } },
    });
  }

  simulateRefundProcessed(providerRefundId: string): SimulatedWebhook {
    return this.simulateRefund('processed', providerRefundId);
  }

  simulateTransfer(
    outcome: 'processed' | 'failed',
    providerTransferId: string,
    amountPaise?: number,
  ): SimulatedWebhook {
    const amount = amountPaise ?? this.transfers.get(providerTransferId)?.amountPaise;
    if (amount === undefined) throw new Error(`Unknown fake transfer ${providerTransferId}`);
    return this.sign(`transfer.${outcome}`, {
      transfer: { entity: { id: providerTransferId, amount, status: outcome } },
    });
  }

  simulateAccount(
    outcome: 'activated' | 'needs_clarification' | 'rejected',
    providerAccountId: string,
  ): SimulatedWebhook {
    return this.sign(`account.${outcome}`, {
      account: { entity: { id: providerAccountId, status: outcome } },
    });
  }

  private sign(event: string, payload: Record<string, unknown>): SimulatedWebhook {
    const rawBody = JSON.stringify({
      entity: 'event',
      event,
      payload,
      created_at: Math.floor(Date.now() / 1000),
    });
    return { eventId: id('evt'), rawBody, signature: hmacSha256Hex(FAKE_WEBHOOK_SECRET, rawBody) };
  }
}
