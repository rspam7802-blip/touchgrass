import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { CitiesModule } from '../cities/cities.module.js';
import { EventsModule } from '../events/events.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminAnalyticsController } from './admin-analytics.controller.js';
import { AnalyticsCountersService } from './analytics-counters.service.js';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';

/**
 * Product analytics (F-PLT-05): the worker tracks domain events and keeps the admin overview's counters;
 * the app posts a few events of its own.
 */
@Module({
  imports: [AccountModule, CitiesModule, EventsModule, UsersModule],
  controllers: [AnalyticsController, AdminAnalyticsController],
  providers: [AnalyticsService, AnalyticsCountersService],
  exports: [AnalyticsService, AnalyticsCountersService],
})
export class AnalyticsModule implements OnModuleInit {
  constructor(
    private readonly counters: AnalyticsCountersService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.accountData.register({
      name: 'analytics-activity',
      // Only "active on day X" markers are kept per person; there is nothing else to export.
      export: () => Promise.resolve({ note: 'Daily activity markers only (no content).' }),
      erase: async (userId, tx) => {
        await this.counters.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
