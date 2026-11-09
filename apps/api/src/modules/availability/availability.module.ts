import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { AvailabilityController, AvailabilityPingController } from './availability.controller.js';
import { AvailabilityHandlers } from './availability.handlers.js';
import { AvailabilityService } from './availability.service.js';

/** "I'm free now" (Phase 8, F-ENG-01). */
@Module({
  imports: [
    AccountModule,
    ModerationModule,
    NotificationsModule,
    ProfilesModule,
    SocialGraphModule,
  ],
  controllers: [AvailabilityController, AvailabilityPingController],
  providers: [AvailabilityService, AvailabilityHandlers],
  exports: [AvailabilityService, AvailabilityHandlers],
})
export class AvailabilityModule implements OnModuleInit {
  constructor(
    private readonly availability: AvailabilityService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.accountData.register({
      name: 'availability',
      export: (userId) => this.availability.exportFor(userId),
      erase: async (userId, tx) => {
        await this.availability.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
