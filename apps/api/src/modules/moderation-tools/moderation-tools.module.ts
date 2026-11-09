import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminUsersService } from './admin-users.service.js';
import { ModerationToolsController } from './moderation-tools.controller.js';
import { ModerationToolsService } from './moderation-tools.service.js';
import { SanctionsService } from './sanctions.service.js';

/**
 * Moderator tooling on top of the moderation queue (Phase 9). Content modules plug in through
 * `ModerationTargetRegistry`, so this module never touches their tables.
 */
@Module({
  imports: [
    AccountModule,
    AuthModule,
    ModerationModule,
    NotificationsModule,
    ProfilesModule,
    UsersModule,
  ],
  controllers: [ModerationToolsController],
  providers: [ModerationToolsService, SanctionsService, AdminUsersService],
  exports: [SanctionsService],
})
export class ModerationToolsModule implements OnModuleInit {
  constructor(
    private readonly sanctions: SanctionsService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    // Sanctions on someone are part of their data export. They are kept on erasure on purpose (D-163): a banned
    // person deleting their account must not wipe the record that stops them coming back.
    this.accountData.register({
      name: 'sanctions',
      export: async (userId) => ({
        sanctions: (await this.sanctions.history(userId)).map(({ byName: _by, ...s }) => s),
      }),
      erase: () => Promise.resolve(undefined),
    });
  }
}
