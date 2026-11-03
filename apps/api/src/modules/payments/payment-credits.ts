import { Injectable } from '@nestjs/common';
import type { Tx } from '../../infra/database/database.module.js';

export type CreditReservation = 'ok' | 'NO_CREDIT' | 'CREDIT_TOO_SMALL';

export interface CreditProvider {
  /** Spends one free-entry credit on this payment, inside the checkout transaction. */
  reserve(
    tx: Tx,
    userId: string,
    paymentId: string,
    eventId: string,
    pricePaise: number,
  ): Promise<CreditReservation>;
  /** Gives the credit back when its ticket is refunded. Returns whether one was restored. */
  restore(tx: Tx, paymentId: string): Promise<boolean>;
}

/**
 * Free-entry credits (referral rewards, F-GRW-01) plug into checkout here, so payments never imports the
 * referrals module. Without a provider nobody has credits.
 */
@Injectable()
export class PaymentCredits {
  private provider: CreditProvider | null = null;

  register(provider: CreditProvider): void {
    if (this.provider) throw new Error('Credit provider already registered');
    this.provider = provider;
  }

  reserve(
    tx: Tx,
    userId: string,
    paymentId: string,
    eventId: string,
    pricePaise: number,
  ): Promise<CreditReservation> {
    return this.provider
      ? this.provider.reserve(tx, userId, paymentId, eventId, pricePaise)
      : Promise.resolve('NO_CREDIT');
  }

  restore(tx: Tx, paymentId: string): Promise<boolean> {
    return this.provider ? this.provider.restore(tx, paymentId) : Promise.resolve(false);
  }
}
