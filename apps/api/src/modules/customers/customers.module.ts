import { Module } from '@nestjs/common';
import { CitiesModule } from '../cities/cities.module.js';
import { CrewsModule } from '../crews/crews.module.js';
import { EventsModule } from '../events/events.module.js';
import { HostRatingReaderModule } from '../feedback/host-rating-reader.js';
import { InterestsModule } from '../interests/interests.module.js';
import { InvitesModule } from '../invites/invites.module.js';
import { ModerationToolsModule } from '../moderation-tools/moderation-tools.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { ReferralsModule } from '../referrals/referrals.module.js';
import { ReliabilityReaderModule } from '../reliability/reliability-reader.js';
import { SafetyModule } from '../safety/safety.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { SocialModule } from '../social/social.module.js';
import { UsersModule } from '../users/users.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';

/** Staff views across modules (D-192). A leaf: nothing imports it. */
@Module({
  imports: [
    CitiesModule,
    CrewsModule,
    EventsModule,
    HostRatingReaderModule,
    InterestsModule,
    InvitesModule,
    ModerationToolsModule,
    PaymentsModule,
    ProfilesModule,
    ReferralsModule,
    ReliabilityReaderModule,
    SafetyModule,
    SocialGraphModule,
    SocialModule,
    UsersModule,
  ],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
