import { Module } from '@nestjs/common';
import { CitiesController } from './cities.controller.js';
import { CitiesService } from './cities.service.js';
import { CityWaitlistController } from './city-waitlist.controller.js';
import { CityWaitlistService } from './city-waitlist.service.js';

/**
 * Cities are data (F-GRW-03): the catalog, admin edits and the waitlist for cities not open yet. A leaf
 * module (profiles, events and venues import it): launch notifications go out from the worker on
 * `city.launched`, and the social module registers the waitlist's account data.
 */
@Module({
  controllers: [CityWaitlistController, CitiesController],
  providers: [CitiesService, CityWaitlistService],
  exports: [CitiesService, CityWaitlistService],
})
export class CitiesModule {}
