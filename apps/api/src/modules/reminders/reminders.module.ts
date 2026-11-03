import { Module } from '@nestjs/common';
import { CitiesModule } from '../cities/cities.module.js';
import { EventsModule } from '../events/events.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { RemindersHandlers } from './reminders.handlers.js';
import { RemindersService } from './reminders.service.js';
import { SquadSignalsService } from './squad-signals.service.js';

/** Reminders and activity notifications (Phase 10, F-NOT-02). */
@Module({
  imports: [EventsModule, NotificationsModule, ProfilesModule, CitiesModule, SocialGraphModule],
  providers: [RemindersService, RemindersHandlers, SquadSignalsService],
  exports: [RemindersService, RemindersHandlers, SquadSignalsService],
})
export class RemindersModule {}
