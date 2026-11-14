import { HostRatingReaderModule } from '../feedback/host-rating-reader.js';
import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { CitiesModule } from '../cities/cities.module.js';
import { CrewsModule } from '../crews/crews.module.js';
import { EventsModule } from '../events/events.module.js';
import { InterestsModule } from '../interests/interests.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { UsersModule } from '../users/users.module.js';
import { VenuesModule } from '../venues/venues.module.js';
import { AdminWeightsController } from './admin-weights.controller.js';
import { RankingWeightsService } from './ranking-weights.service.js';
import { DiscoveryController } from './discovery.controller.js';
import { DiscoveryHandlers } from './discovery.handlers.js';
import { DiscoveryService } from './discovery.service.js';
import { SearchService } from './search.service.js';
import { WeatherService } from './weather.service.js';

/** Discovery (Phase 4, F-DSC-01..09): feed, filters, map, near you, previews, recommendations, weather, search. */
@Module({
  imports: [
    HostRatingReaderModule,
    AccountModule,
    CitiesModule,
    CrewsModule,
    EventsModule,
    InterestsModule,
    ProfilesModule,
    SocialGraphModule,
    UsersModule,
    VenuesModule,
  ],
  controllers: [DiscoveryController, AdminWeightsController],
  providers: [
    DiscoveryService,
    SearchService,
    WeatherService,
    RankingWeightsService,
    DiscoveryHandlers,
  ],
  exports: [DiscoveryService, WeatherService, DiscoveryHandlers],
})
export class DiscoveryModule implements OnModuleInit {
  constructor(
    private readonly discovery: DiscoveryService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.accountData.register({
      name: 'discovery',
      export: (userId) => this.discovery.exportFor(userId),
      erase: async (userId, tx) => {
        await this.discovery.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
