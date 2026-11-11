import {
  type CreateOrderInput,
  type CreatePaymentLinkInput,
  type DirectTransferInput,
  type LinkedAccountInput,
  type PaymentWebhookEvent,
  PaymentsGateway,
  type ProviderOrder,
  type ProviderPaymentLink,
  type ProviderRefund,
  type RefundInput,
  type TransferInput,
} from './payments.port.js';

/**
 * Free-plans-only launch (D-165, `PAYMENTS_PROVIDER=disabled`): nobody can sell tickets, so nothing should
 * reach a gateway. Every money call fails loudly, and no webhook signature is ever accepted.
 */
export class DisabledPaymentsGateway extends PaymentsGateway {
  readonly publicKeyId = '';

  createOrder(_input: CreateOrderInput): Promise<ProviderOrder> {
    return Promise.reject(new Error(this.reason()));
  }
  createPaymentLink(_input: CreatePaymentLinkInput): Promise<ProviderPaymentLink> {
    return Promise.reject(new Error(this.reason()));
  }
  refund(_input: RefundInput): Promise<ProviderRefund> {
    return Promise.reject(new Error(this.reason()));
  }
  createLinkedAccount(_input: LinkedAccountInput): Promise<{ providerAccountId: string }> {
    return Promise.reject(new Error(this.reason()));
  }
  transfer(_input: TransferInput): Promise<{ providerTransferId: string }> {
    return Promise.reject(new Error(this.reason()));
  }
  directTransfer(_input: DirectTransferInput): Promise<{ providerTransferId: string }> {
    return Promise.reject(new Error(this.reason()));
  }
  verifyWebhookSignature(_rawBody: string, _signature: string): boolean {
    return false;
  }
  parseWebhook(_rawBody: string): PaymentWebhookEvent {
    throw new Error(this.reason());
  }

  private reason(): string {
    return 'Payments are disabled (PAYMENTS_PROVIDER=disabled)';
  }
}
