import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { MediaModule } from '../media/media.module.js';
import { MediaService } from '../media/media.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminVerificationController, VerificationController } from './verification.controller.js';
import { VerificationService } from './verification.service.js';

/** Verified profiles (Phase 9, F-SAF-01). */
@Module({
  imports: [AccountModule, MediaModule, NotificationsModule, ProfilesModule, UsersModule],
  controllers: [VerificationController, AdminVerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule implements OnModuleInit {
  constructor(
    private readonly verification: VerificationService,
    private readonly media: MediaService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.accountData.register({
      name: 'verification',
      export: (userId) => this.verification.exportFor(userId),
      erase: async (userId, tx) => {
        const selfies = await this.verification.eraseFor(userId, tx);
        return selfies.length > 0 ? () => this.media.destroy(selfies) : undefined;
      },
    });
  }
}
