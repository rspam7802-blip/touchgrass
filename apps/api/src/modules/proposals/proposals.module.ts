import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventsModule } from '../events/events.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ModerationTargetRegistry } from '../moderation/moderation-targets.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { UsersModule } from '../users/users.module.js';
import { VenuesModule } from '../venues/venues.module.js';
import { ProposalsController } from './proposals.controller.js';
import { ProposalsHandlers } from './proposals.handlers.js';
import { ProposalsService } from './proposals.service.js';

/** Collaborative plans (Phase 8, F-ENG-03). */
@Module({
  imports: [
    AccountModule,
    EventsModule,
    ModerationModule,
    NotificationsModule,
    ProfilesModule,
    SocialGraphModule,
    UsersModule,
    VenuesModule,
  ],
  controllers: [ProposalsController],
  providers: [ProposalsService, ProposalsHandlers],
  exports: [ProposalsService, ProposalsHandlers],
})
export class ProposalsModule implements OnModuleInit {
  constructor(
    private readonly proposals: ProposalsService,
    private readonly accountData: AccountDataRegistry,
    private readonly moderationTargets: ModerationTargetRegistry,
  ) {}

  onModuleInit(): void {
    this.moderationTargets.register({
      type: 'proposal',
      preview: (id) => this.proposals.moderationPreview(id),
      release: (id, tx) => this.proposals.releaseHeld(id, tx),
      remove: (id, tx) => this.proposals.removeForModeration(id, tx),
    });
    this.accountData.register({
      name: 'proposals',
      export: (userId) => this.proposals.exportFor(userId),
      erase: async (userId, tx) => {
        await this.proposals.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
