import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { CitiesModule } from '../cities/cities.module.js';
import { InterestsModule } from '../interests/interests.module.js';
import { MediaModule } from '../media/media.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ModerationTargetRegistry } from '../moderation/moderation-targets.js';
import { PlatformModule } from '../platform/platform.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { AdminEventsController } from './admin-events.controller.js';
import { AdminEventsService } from './admin-events.service.js';
import { ActivityService } from '../social/activity/activity.service.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { ReportTargetRegistry } from '../social/reports/report-targets.registry.js';
import { SocialModule } from '../social/social.module.js';
import { UsersModule } from '../users/users.module.js';
import { VenuesModule } from '../venues/venues.module.js';
import { ReliabilityReaderModule } from '../reliability/reliability-reader.js';
import { CheckInService } from './check-in.service.js';
import { EventAccessService } from './event-access.service.js';
import { EventActivityHandlers } from './event-activity.handlers.js';
import { EventInvitesService } from './event-invites.service.js';
import { EventSearchService } from './event-search.service.js';
import { EventHooks } from './event-hooks.js';
import { EventStore } from './event-store.service.js';
import { EventViewsService } from './event-views.service.js';
import { EventViewService } from './event-view.service.js';
import {
  EventsController,
  PlusOnesController,
  PublicEventsController,
} from './events.controller.js';
import { EventsService } from './events.service.js';
import { PlusOneClaimModule } from './plus-one/plus-one-claim.module.js';
import { RsvpService } from './rsvp.service.js';
import { WaitlistService } from './waitlist.service.js';

/** Events core (Phase 3): plot, visibility, invites, RSVP, capacity, waitlist, +1s, mystery, hosts, check-in. */
@Module({
  imports: [
    AccountModule,
    CitiesModule,
    InterestsModule,
    ModerationModule,
    MediaModule,
    PlatformModule,
    ProfilesModule,
    SocialGraphModule,
    SocialModule,
    UsersModule,
    VenuesModule,
    PlusOneClaimModule,
    ReliabilityReaderModule,
  ],
  controllers: [
    EventsController,
    PlusOnesController,
    PublicEventsController,
    AdminEventsController,
  ],
  providers: [
    AdminEventsService,
    EventStore,
    EventAccessService,
    EventViewService,
    EventsService,
    RsvpService,
    WaitlistService,
    CheckInService,
    EventInvitesService,
    EventActivityHandlers,
    EventSearchService,
    EventHooks,
    EventViewsService,
  ],
  exports: [
    AdminEventsService,
    EventHooks,
    EventInvitesService,
    EventViewsService,
    EventSearchService,
    RsvpService,
    EventsService,
    WaitlistService,
    EventActivityHandlers,
    EventStore,
    EventAccessService,
    EventViewService,
  ],
})
export class EventsModule implements OnModuleInit {
  constructor(
    private readonly events: EventsService,
    private readonly targets: ReportTargetRegistry,
    private readonly moderationTargets: ModerationTargetRegistry,
    private readonly activity: ActivityService,
    private readonly accountData: AccountDataRegistry,
    private readonly store: EventStore,
  ) {}

  onModuleInit(): void {
    this.targets.register({
      type: 'event',
      resolve: (reporterId, eventId) => this.events.reportTarget(reporterId, eventId),
    });
    this.moderationTargets.register({
      type: 'event',
      preview: (id) => this.events.moderationPreview(id),
      release: (id, tx) => this.events.releaseHeld(id, tx),
      remove: (id, tx) => this.events.removeForModeration(id, tx),
    });
    this.activity.registerObjectType('event', (viewerId, ids) =>
      this.events.visibleTitles(viewerId, ids),
    );
    this.accountData.register({
      name: 'events',
      export: (userId) => this.events.exportFor(userId),
      erase: async (userId, tx) => {
        const touched = await this.events.eraseFor(userId, tx);
        // Cached cores are refreshed once the purge has committed.
        return async () => {
          await Promise.all(touched.map((id) => this.store.invalidate(id)));
        };
      },
    });
  }
}
