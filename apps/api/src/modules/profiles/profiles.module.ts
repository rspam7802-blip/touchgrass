import { Module, type OnModuleInit } from '@nestjs/common';
import { CitiesModule } from '../cities/cities.module.js';
import { InterestsModule } from '../interests/interests.module.js';
import { MediaModule } from '../media/media.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ModerationTargetRegistry } from '../moderation/moderation-targets.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { UsersModule } from '../users/users.module.js';
import { PeopleService } from './people.service.js';
import { EventStatsModule } from '../events/stats/event-stats.module.js';
import { EventProfileStats } from '../events/stats/event-stats.service.js';
import { ProfileStatsReader } from './profile-stats.port.js';
import { ProfilesController, PublicProfilesController } from './profiles.controller.js';
import { OnboardingChecks } from './onboarding-checks.js';
import { ProfilesService } from './profiles.service.js';
import { HostRatingReaderModule } from '../feedback/host-rating-reader.js';

@Module({
  imports: [
    UsersModule,
    CitiesModule,
    InterestsModule,
    MediaModule,
    ModerationModule,
    SocialGraphModule,
    EventStatsModule,
    HostRatingReaderModule,
  ],
  controllers: [ProfilesController, PublicProfilesController],
  providers: [
    ProfilesService,
    PeopleService,
    OnboardingChecks,
    { provide: ProfileStatsReader, useExisting: EventProfileStats },
  ],
  exports: [ProfilesService, PeopleService, ProfileStatsReader, OnboardingChecks],
})
export class ProfilesModule implements OnModuleInit {
  constructor(
    private readonly profiles: ProfilesService,
    private readonly moderationTargets: ModerationTargetRegistry,
  ) {}

  onModuleInit(): void {
    // A person's own words: the bio (held by the text filter, or reported with the profile).
    this.moderationTargets.register({
      type: 'user',
      preview: (id) => this.profiles.moderationPreview(id),
      release: (id, tx) => this.profiles.releaseBio(id, tx),
      remove: (id, tx) => this.profiles.removeBio(id, tx),
    });
  }
}
