import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventsModule } from '../events/events.module.js';
import { UsersModule } from '../users/users.module.js';
import { CalendarController } from './calendar.controller.js';
import { CalendarService } from './calendar.service.js';

/** Calendar sync (Phase 10, F-CAL-01). */
@Module({
  imports: [AccountModule, EventsModule, UsersModule],
  controllers: [CalendarController],
  providers: [CalendarService],
})
export class CalendarModule implements OnModuleInit {
  constructor(
    private readonly calendar: CalendarService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    // Only the link version is stored; the plans themselves are exported by the events module.
    this.accountData.register({
      name: 'calendar',
      export: () => Promise.resolve({}),
      erase: async (userId, tx) => {
        await this.calendar.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
