import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { CitiesModule } from '../cities/cities.module.js';
import { VenuesController } from './venues.controller.js';
import { VenuesService } from './venues.service.js';

/** Venues and saved places (F-EVT-02). */
@Module({
  imports: [CitiesModule, AccountModule],
  controllers: [VenuesController],
  providers: [VenuesService],
  exports: [VenuesService],
})
export class VenuesModule implements OnModuleInit {
  constructor(
    private readonly venues: VenuesService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.accountData.register({
      name: 'venues',
      export: async (userId) => ({ savedVenues: await this.venues.exportFor(userId) }),
      erase: async (userId, tx) => {
        await this.venues.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
