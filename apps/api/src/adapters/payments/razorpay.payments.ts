import { type FetchFn, requestJson } from '../http/http-client.js';
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

export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
  baseUrl?: string;
}

/** Razorpay Orders, Payment Links, Refunds and Route (linked accounts + transfers). UPI-first checkout is configured client-side. */
export class RazorpayPaymentsGateway extends PaymentsGateway {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(
    private readonly config: RazorpayConfig,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    super();
    this.baseUrl = config.baseUrl ?? 'https://api.razorpay.com';
    this.authHeader = `Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`;
  }

  get publicKeyId(): string {
    return this.config.keyId;
  }

  private call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    return requestJson<T>(this.fetchFn, 'razorpay', `${this.baseUrl}${path}`, {
      method,
      headers: { authorization: this.authHeader },
      body,
    });
  }

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const res = await this.call<{ id: string; amount: number }>('POST', '/v1/orders', {
      amount: input.amountPaise,
      currency: 'INR',
      receipt: input.receipt.slice(0, 40),
      notes: input.notes ?? {},
    });
    return { providerOrderId: res.id, amountPaise: res.amount, currency: 'INR' };
  }

  async createPaymentLink(input: CreatePaymentLinkInput): Promise<ProviderPaymentLink> {
    const res = await this.call<{ id: string; short_url: string }>('POST', '/v1/payment_links', {
      amount: input.amountPaise,
      currency: 'INR',
      reference_id: input.referenceId.slice(0, 40),
      description: input.description,
      customer: input.customerPhoneE164 ? { contact: input.customerPhoneE164 } : undefined,
      notify: { sms: Boolean(input.customerPhoneE164), email: false },
      callback_url: input.callbackUrl,
      callback_method: 'get',
      expire_by: input.expireBy ? Math.floor(input.expireBy.getTime() / 1000) : undefined,
      upi_link: false,
    });
    return { providerLinkId: res.id, shortUrl: res.short_url };
  }

  async refund(input: RefundInput): Promise<ProviderRefund> {
    const res = await this.call<{ id: string; status: string }>(
      'POST',
      `/v1/payments/${encodeURIComponent(input.providerPaymentId)}/refund`,
      {
        amount: input.amountPaise,
        speed: 'normal',
        notes: input.notes ?? {},
      },
    );
    const status =
      res.status === 'processed' ? 'processed' : res.status === 'failed' ? 'failed' : 'pending';
    return { providerRefundId: res.id, status };
  }

  async createLinkedAccount(input: LinkedAccountInput): Promise<{ providerAccountId: string }> {
    const res = await this.call<{ id: string }>('POST', '/v2/accounts', {
      email: input.email,
      phone: input.phoneE164.replace(/^\+91/, ''),
      type: 'route',
      reference_id: input.referenceId.slice(0, 20),
      legal_business_name: input.legalBusinessName,
      business_type: 'individual',
      contact_name: input.contactName,
    });
    return { providerAccountId: res.id };
  }

  async transfer(input: TransferInput): Promise<{ providerTransferId: string }> {
    const res = await this.call<{ items: { id: string }[] }>(
      'POST',
      `/v1/payments/${encodeURIComponent(input.providerPaymentId)}/transfers`,
      {
        transfers: [
          {
            account: input.providerAccountId,
            amount: input.amountPaise,
            currency: 'INR',
            notes: input.notes ?? {},
            on_hold: false,
          },
        ],
      },
    );
    const first = res.items[0];
    if (!first) throw new Error('Razorpay returned no transfer');
    return { providerTransferId: first.id };
  }

  /** Route "direct transfer" from the platform balance (credit-paid seats have no payment to split). */
  async directTransfer(input: DirectTransferInput): Promise<{ providerTransferId: string }> {
    const res = await this.call<{ id: string }>('POST', '/v1/transfers', {
      account: input.providerAccountId,
      amount: input.amountPaise,
      currency: 'INR',
      notes: input.notes ?? {},
    });
    return { providerTransferId: res.id };
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    return constantTimeEqualHex(hmacSha256Hex(this.config.webhookSecret, rawBody), signature);
  }

  parseWebhook(rawBody: string): PaymentWebhookEvent {
    return parseRazorpayWebhook(rawBody);
  }
}
