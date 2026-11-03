import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventHooks } from '../events/event-hooks.js';
import { EventsModule } from '../events/events.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { VenuesModule } from '../venues/venues.module.js';
import {
  EventPerksController,
  PerkPassesController,
  VenuesAdminController,
} from './perks.controller.js';
import { PerksService } from './perks.service.js';

/** Venue partnerships and perks (Phase 6, F-PAY-04). */
@Module({
  imports: [AccountModule, EventsModule, ProfilesModule, VenuesModule],
  controllers: [EventPerksController, PerkPassesController, VenuesAdminController],
  providers: [PerksService],
  exports: [PerksService],
})
export class PerksModule implements OnModuleInit {
  constructor(
    private readonly perks: PerksService,
    private readonly hooks: EventHooks,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.hooks.register({
      perks: (userId, core, facts) => this.perks.forEvent(userId, core, facts),
    });
    this.accountData.register({
      name: 'perks',
      export: (userId) => this.perks.exportFor(userId),
      erase: async (userId, tx) => {
        await this.perks.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
