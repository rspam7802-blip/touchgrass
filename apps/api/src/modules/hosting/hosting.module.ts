import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventHooks } from '../events/event-hooks.js';
import { EventsModule } from '../events/events.module.js';
import { EventStatsModule } from '../events/stats/event-stats.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { FeedbackReader } from './feedback-reader.js';
import { HostAnalyticsService } from './host-analytics.service.js';
import { HostApplicationsAdminController, HostingController } from './hosting.controller.js';
import { HostingService } from './hosting.service.js';

/** Hosting (Phase 6): who may sell tickets (F-HST-01) and host insights (F-HST-02). */
@Module({
  imports: [
    AccountModule,

    EventsModule,
    EventStatsModule,
    PaymentsModule,
    PlatformModule,
    ProfilesModule,
    UsersModule,
  ],
  controllers: [HostingController, HostApplicationsAdminController],
  providers: [HostingService, HostAnalyticsService, FeedbackReader],
  exports: [HostingService, FeedbackReader],
})
export class HostingModule implements OnModuleInit {
  constructor(
    private readonly hosting: HostingService,
    private readonly hooks: EventHooks,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.hooks.register({ canHostPaid: (userId) => this.hosting.canHostPaid(userId) });
    this.accountData.register({
      name: 'hosting',
      export: (userId) => this.hosting.exportFor(userId),
      erase: async (userId, tx) => {
        await this.hosting.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
