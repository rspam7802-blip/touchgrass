import { Module, type OnModuleInit } from '@nestjs/common';
import { eq, or } from 'drizzle-orm';
import { newcomerWelcomes } from '../../infra/database/schema/index.js';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { ChatModule } from '../chat/chat.module.js';
import { EventsModule } from '../events/events.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { AtEventController, IcebreakerAdminController } from './at-event.controller.js';
import { AtEventService } from './at-event.service.js';

/** At the event (Phase 5, F-ATE-01..03): icebreakers, find-your-group signal, newcomer welcome. */
@Module({
  imports: [AccountModule, ChatModule, EventsModule, ProfilesModule],
  controllers: [AtEventController, IcebreakerAdminController],
  providers: [AtEventService],
  exports: [AtEventService],
})
export class AtEventModule implements OnModuleInit {
  constructor(private readonly accountData: AccountDataRegistry) {}

  onModuleInit(): void {
    this.accountData.register({
      name: 'at-event',
      export: () => Promise.resolve({}),
      erase: async (userId, tx) => {
        await tx.delete(newcomerWelcomes).where(eq(newcomerWelcomes.userId, userId));
        await tx
          .update(newcomerWelcomes)
          .set({ welcomedBy: null })
          .where(or(eq(newcomerWelcomes.welcomedBy, userId)));
        return undefined;
      },
    });
  }
}
