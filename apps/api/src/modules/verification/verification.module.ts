import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { MediaModule } from '../media/media.module.js';
import { MediaService } from '../media/media.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminVerificationController, VerificationController } from './verification.controller.js';
import { PlatformModule } from '../platform/platform.module.js';
import { FeatureFlagsService } from '../platform/feature-flags.service.js';
import { OnboardingChecks } from '../profiles/onboarding-checks.js';
import { VerificationService } from './verification.service.js';

/** Verified profiles (Phase 9, F-SAF-01). */
@Module({
  imports: [
    AccountModule,
    MediaModule,
    NotificationsModule,
    PlatformModule,
    ProfilesModule,
    UsersModule,
  ],
  controllers: [VerificationController, AdminVerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule implements OnModuleInit {
  constructor(
    private readonly verification: VerificationService,
    private readonly media: MediaService,
    private readonly accountData: AccountDataRegistry,
    private readonly onboarding: OnboardingChecks,
    private readonly flags: FeatureFlagsService,
  ) {}

  onModuleInit(): void {
    // Profile setup includes a verification selfie while the flag is on (D-181).
    this.onboarding.register(
      'verification',
      async (userId) =>
        !(await this.flags.isEnabled('require_verification_to_join')) ||
        (await this.verification.hasSubmitted(userId)),
    );
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
