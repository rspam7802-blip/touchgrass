import { Inject, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { FakePaymentsGateway } from '../../adapters/payments/fake.payments.js';
import { PaymentsGateway } from '../../adapters/payments/payments.port.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { CitiesModule } from '../cities/cities.module.js';
import { EventHooks } from '../events/event-hooks.js';
import { EventsModule } from '../events/events.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminPaymentsService } from './admin-payments.service.js';
import {
  AdminPaymentsController,
  CheckoutPageController,
  EventCheckoutController,
  HostPayoutsController,
  PaymentsController,
  WebhooksController,
} from './payments.controller.js';
import { PaymentsHandlers } from './payments.handlers.js';
import { PaymentCredits } from './payment-credits.js';
import { PaymentsService } from './payments.service.js';
import { PayoutsService } from './payouts.service.js';
import { RefundsService } from './refunds.service.js';
import { WebhooksService } from './webhooks.service.js';

/** Ticketing, refunds, payouts, receipts and Razorpay webhooks (Phase 6, F-PAY-01..03, F-PAY-05). */
@Module({
  imports: [AccountModule, CitiesModule, EventsModule, PlatformModule, ProfilesModule, UsersModule],
  controllers: [
    PaymentsController,
    EventCheckoutController,
    CheckoutPageController,
    WebhooksController,
    HostPayoutsController,
    AdminPaymentsController,
  ],
  providers: [
    PaymentCredits,
    PaymentsService,
    RefundsService,
    PayoutsService,
    WebhooksService,
    AdminPaymentsService,
    PaymentsHandlers,
  ],
  exports: [
    PaymentCredits,
    PaymentsService,
    RefundsService,
    PayoutsService,
    WebhooksService,
    PaymentsHandlers,
  ],
})
export class PaymentsModule implements OnModuleInit {
  private readonly logger = new Logger(PaymentsModule.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly gateway: PaymentsGateway,
    private readonly payments: PaymentsService,
    private readonly payouts: PayoutsService,
    private readonly webhooks: WebhooksService,
    private readonly hooks: EventHooks,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.hooks.register({
      viewerPayment: (userId, eventId) => this.payments.viewerPayment(userId, eventId),
      hasPayments: (eventId) => this.payments.hasPayments(eventId),
    });
    this.accountData.register({
      name: 'payments',
      export: async (userId) => ({
        ...(await this.payments.exportFor(userId)),
        ...(await this.payouts.exportFor(userId)),
      }),
      erase: async (userId, tx) => {
        await this.payments.eraseFor(userId, tx);
        await this.payouts.eraseFor(userId, tx);
        return undefined;
      },
    });
    // Local development with the fake gateway: refunds, transfers and KYC settle on their own through the real
    // webhook pipeline. Never with Razorpay, never in production.
    if (
      this.gateway instanceof FakePaymentsGateway &&
      this.env.PAYMENTS_FAKE_AUTO_SETTLE &&
      this.env.NODE_ENV !== 'production'
    ) {
      this.gateway.onSettle = (w) => {
        this.webhooks.ingest(w.rawBody, w.signature, w.eventId).catch((err: unknown) => {
          this.logger.warn(`Fake settlement failed: ${String(err)}`);
        });
      };
    }
  }
}
