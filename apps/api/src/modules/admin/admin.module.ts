import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CitiesModule } from '../cities/cities.module.js';
import { EventsModule } from '../events/events.module.js';
import { InterestsModule } from '../interests/interests.module.js';
import { InvitesModule } from '../invites/invites.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { PlatformModule } from '../platform/platform.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminConsoleController } from './admin-console.controller.js';
import { AdminTaxonomyController } from './admin-taxonomy.controller.js';
import { AdminController } from './admin.controller.js';

@Module({
  imports: [
    InvitesModule,
    PlatformModule,
    ModerationModule,
    AuthModule,
    CitiesModule,
    ProfilesModule,
    UsersModule,
    EventsModule,
    InterestsModule,
  ],
  controllers: [AdminController, AdminConsoleController, AdminTaxonomyController],
})
export class AdminModule {}
