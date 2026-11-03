import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventsModule } from '../events/events.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { PublicLiveController, SafetyController } from './safety.controller.js';
import { SafetyService } from './safety.service.js';

/** Trusted contacts, live location sharing and SOS (Phase 9, F-SAF-04, F-WEB-02). */
@Module({
  imports: [
    AccountModule,
    EventsModule,
    NotificationsModule,
    PlatformModule,
    ProfilesModule,
    UsersModule,
  ],
  controllers: [SafetyController, PublicLiveController],
  providers: [SafetyService],
  exports: [SafetyService],
})
export class SafetyModule implements OnModuleInit {
  constructor(
    private readonly safety: SafetyService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.accountData.register({
      name: 'safety',
      export: (userId) => this.safety.exportFor(userId),
      erase: async (userId, tx) => {
        await this.safety.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
