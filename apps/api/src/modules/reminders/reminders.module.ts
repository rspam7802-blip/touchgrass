import { Module } from '@nestjs/common';
import { CitiesModule } from '../cities/cities.module.js';
import { EventsModule } from '../events/events.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { RemindersHandlers } from './reminders.handlers.js';
import { RemindersService } from './reminders.service.js';

/** Reminders and activity notifications (Phase 10, F-NOT-02). */
@Module({
  imports: [EventsModule, NotificationsModule, ProfilesModule, CitiesModule],
  providers: [RemindersService, RemindersHandlers],
  exports: [RemindersService, RemindersHandlers],
})
export class RemindersModule {}
