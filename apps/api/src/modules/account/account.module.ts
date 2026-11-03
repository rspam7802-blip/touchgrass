import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CitiesModule } from '../cities/cities.module.js';
import { InterestsModule } from '../interests/interests.module.js';
import { InvitesModule } from '../invites/invites.module.js';
import { MediaModule } from '../media/media.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { AccountDataRegistry } from './account-data.registry.js';
import { AccountService } from './account.service.js';
import { MeController } from './me.controller.js';
import { MeService } from './me.service.js';
import { SettingsService } from './settings.service.js';

@Module({
  imports: [
    AuthModule,
    CitiesModule,
    UsersModule,
    ProfilesModule,
    InvitesModule,
    MediaModule,
    InterestsModule,
    ModerationModule,
  ],
  controllers: [MeController],
  providers: [AccountService, SettingsService, MeService, AccountDataRegistry],
  exports: [AccountService, SettingsService, AccountDataRegistry],
})
export class AccountModule {}
