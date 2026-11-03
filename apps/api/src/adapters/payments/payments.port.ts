import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CreateOrderInput {
  amountPaise: number;
  /** Our payment id; Razorpay's `receipt` (max 40 chars). */
  receipt: string;
  notes?: Record<string, string>;
}
export interface ProviderOrder {
  providerOrderId: string;
  amountPaise: number;
  currency: 'INR';
}
export interface CreatePaymentLinkInput {
  amountPaise: number;
  referenceId: string;
  description: string;
  customerPhoneE164?: string;
  callbackUrl: string;
  expireBy?: Date;
}
export interface ProviderPaymentLink {
  providerLinkId: string;
  shortUrl: string;
}
export interface RefundInput {
  providerPaymentId: string;
  amountPaise: number;
  notes?: Record<string, string>;
}
export interface ProviderRefund {
  providerRefundId: string;
  status: 'pending' | 'processed' | 'failed';
}
export interface LinkedAccountInput {
  referenceId: string;
  email: string;
  phoneE164: string;
  legalBusinessName: string;
  contactName: string;
}
/** A transfer from the platform's own balance (not tied to a captured payment), e.g. for credit-paid seats. */
export interface DirectTransferInput {
  providerAccountId: string;
  amountPaise: number;
  notes?: Record<string, string>;
}
export interface TransferInput {
  providerPaymentId: string;
  providerAccountId: string;
  amountPaise: number;
  notes?: Record<string, string>;
}

export type PaymentWebhookType =
  | 'payment.authorized'
  | 'payment.captured'
  | 'payment.failed'
  | 'order.paid'
  | 'refund.processed'
  | 'refund.failed'
  | 'transfer.processed'
  | 'transfer.failed'
  | 'account.activated'
  | 'account.needs_clarification'
  | 'account.rejected'
  | 'unknown';

export interface PaymentWebhookEvent {
  type: PaymentWebhookType;
  rawType: string;
  providerPaymentId?: string;
  providerOrderId?: string;
  providerRefundId?: string;
  providerTransferId?: string;
  providerAccountId?: string;
  amountPaise?: number;
  /** Payment method (upi, card, netbanking, wallet) on payment events. */
  method?: string;
}

/** Payments gateway port (F-PAY-01..03). Confirmation of payment comes ONLY from verified webhooks. */
export abstract class PaymentsGateway {
  abstract readonly publicKeyId: string;
  abstract createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  abstract createPaymentLink(input: CreatePaymentLinkInput): Promise<ProviderPaymentLink>;
  abstract refund(input: RefundInput): Promise<ProviderRefund>;
  abstract createLinkedAccount(input: LinkedAccountInput): Promise<{ providerAccountId: string }>;
  abstract transfer(input: TransferInput): Promise<{ providerTransferId: string }>;
  abstract directTransfer(input: DirectTransferInput): Promise<{ providerTransferId: string }>;
  abstract verifyWebhookSignature(rawBody: string, signature: string): boolean;
  abstract parseWebhook(rawBody: string): PaymentWebhookEvent;
}

export function hmacSha256Hex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function constantTimeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

interface RazorpayEntity {
  id?: string;
  order_id?: string;
  payment_id?: string;
  amount?: number;
  source?: string;
  method?: string;
}
interface RazorpayWebhookBody {
  event?: string;
  payload?: Record<string, { entity?: RazorpayEntity } | undefined>;
}

const KNOWN: ReadonlySet<string> = new Set([
  'payment.authorized',
  'payment.captured',
  'payment.failed',
  'order.paid',
  'refund.processed',
  'refund.failed',
  'transfer.processed',
  'transfer.failed',
  'account.activated',
  'account.needs_clarification',
  'account.rejected',
]);

/** Razorpay webhook body → normalised event. Shared by the real gateway and the fake (which emits the same shape). */
export function parseRazorpayWebhook(rawBody: string): PaymentWebhookEvent {
  const body = JSON.parse(rawBody) as RazorpayWebhookBody;
  const rawType = body.event ?? 'unknown';
  const payment = body.payload?.payment?.entity;
  const order = body.payload?.order?.entity;
  const refund = body.payload?.refund?.entity;
  const transfer = body.payload?.transfer?.entity;
  const account = body.payload?.account?.entity;
  return {
    type: KNOWN.has(rawType) ? (rawType as PaymentWebhookType) : 'unknown',
    rawType,
    providerPaymentId: payment?.id ?? refund?.payment_id,
    providerOrderId: payment?.order_id ?? order?.id,
    providerRefundId: refund?.id,
    providerTransferId: transfer?.id,
    providerAccountId: account?.id,
    amountPaise: refund?.amount ?? payment?.amount ?? order?.amount ?? transfer?.amount,
    method: payment?.method,
  };
}
