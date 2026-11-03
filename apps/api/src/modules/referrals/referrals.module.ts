import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventsModule } from '../events/events.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentCredits } from '../payments/payment-credits.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { ReferralCodesModule } from './referral-codes.module.js';
import { ReferralsController } from './referrals.controller.js';
import { ReferralsHandlers } from './referrals.handlers.js';
import { ReferralsService } from './referrals.service.js';

/** Referral rewards (Phase 8, F-GRW-01): rewards, priority passes and free-entry credits. */
@Module({
  imports: [
    AccountModule,
    EventsModule,
    NotificationsModule,
    PaymentsModule,
    PlatformModule,
    ProfilesModule,
    ReferralCodesModule,
  ],
  controllers: [ReferralsController],
  providers: [ReferralsService, ReferralsHandlers],
  exports: [ReferralsService, ReferralsHandlers],
})
export class ReferralsModule implements OnModuleInit {
  constructor(
    private readonly referrals: ReferralsService,
    private readonly credits: PaymentCredits,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.credits.register({
      reserve: (tx, userId, paymentId, eventId, price) =>
        this.referrals.reserveCredit(tx, userId, paymentId, eventId, price),
      restore: (tx, paymentId) => this.referrals.restoreCredit(tx, paymentId),
    });
    this.accountData.register({
      name: 'referrals',
      export: (userId) => this.referrals.exportFor(userId),
      erase: async (userId, tx) => {
        await this.referrals.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
