import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, isNull, and } from 'drizzle-orm';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { EmailSender } from '../../adapters/email/email.port.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { payments } from '../../infra/database/schema/index.js';
import type { DomainEventBus } from '../../worker/domain-event-bus.js';
import { EVENT_CANCELLED_EVENT } from '../events/events.service.js';
import { RSVP_CANCELLED_EVENT } from '../events/rsvp.service.js';
import { UsersService } from '../users/users.service.js';
import {
  PAYMENT_CAPTURED_EVENT,
  PaymentsService,
  REFUND_REQUESTED_EVENT,
} from './payments.service.js';
import { receiptEmail } from './receipt-email.js';
import { RefundsService } from './refunds.service.js';

/** Worker side of payments: refunds follow cancellations, receipts are emailed once, refunds are sent. */
@Injectable()
export class PaymentsHandlers {
  private readonly logger = new Logger(PaymentsHandlers.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly users: UsersService,
    private readonly email: EmailSender,
    @Inject(ENV) private readonly env: Env,
  ) {}

  registerOn(bus: DomainEventBus): void {
    bus.subscribe(RSVP_CANCELLED_EVENT, 'payments.attendee-cancelled', async (e) => {
      const userId = String(e.payload.userId);
      if (e.payload.wasHeld === true) {
        const open = await this.db
          .select()
          .from(payments)
          .where(and(eq(payments.eventId, e.aggregateId), eq(payments.userId, userId)));
        for (const p of open)
          if (p.status === 'created' || p.status === 'failed')
            await this.payments.release(p, 'expired', new Date());
      }
      if (e.payload.hadSeat === true) {
        const at =
          typeof e.payload.cancelledAt === 'string' ? new Date(e.payload.cancelledAt) : new Date();
        await this.refunds.onAttendeeCancelled(e.aggregateId, userId, at);
      }
    });
    bus.subscribe(EVENT_CANCELLED_EVENT, 'payments.event-cancelled', async (e) => {
      await this.refunds.onEventCancelled(e.aggregateId);
    });
    bus.subscribe(REFUND_REQUESTED_EVENT, 'payments.send-refund', async (e) => {
      await this.refunds.execute(String(e.payload.refundId));
    });
    bus.subscribe(PAYMENT_CAPTURED_EVENT, 'payments.email-receipt', async (e) => {
      await this.emailReceipt(String(e.payload.paymentId));
    });
  }

  /** At most once per payment: the row is claimed before sending. */
  async emailReceipt(paymentId: string): Promise<boolean> {
    const [p] = await this.db.select().from(payments).where(eq(payments.id, paymentId));
    if (!p?.userId || p.receiptEmailedAt) return false;
    const user = await this.users.findById(p.userId);
    if (!user?.receiptEmail) return false;
    const receipt = await this.payments.buildReceipt(p);
    const [claimed] = await this.db
      .update(payments)
      .set({ receiptEmailedAt: new Date() })
      .where(and(eq(payments.id, p.id), isNull(payments.receiptEmailedAt)))
      .returning({ id: payments.id });
    if (!claimed) return false;
    try {
      await this.email.send(
        receiptEmail(user.receiptEmail, receipt, user.language, this.env.WEB_PUBLIC_URL),
      );
      return true;
    } catch (err) {
      // Release the claim so the outbox retry sends it.
      await this.db.update(payments).set({ receiptEmailedAt: null }).where(eq(payments.id, p.id));
      this.logger.warn(`Receipt email for ${p.id} failed: ${String(err)}`);
      throw err;
    }
  }
}
