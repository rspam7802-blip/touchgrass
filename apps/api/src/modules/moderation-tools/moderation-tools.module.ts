import { Module } from '@nestjs/common';
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
  imports: [AuthModule, ModerationModule, NotificationsModule, ProfilesModule, UsersModule],
  controllers: [ModerationToolsController],
  providers: [ModerationToolsService, SanctionsService, AdminUsersService],
  exports: [SanctionsService],
})
export class ModerationToolsModule {}
