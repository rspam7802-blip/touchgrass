import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { ChatModule } from '../chat/chat.module.js';
import { ConversationGates } from '../chat/conversation-gates.js';
import { EventHooks } from '../events/event-hooks.js';
import { EventsModule } from '../events/events.module.js';
import { MediaModule } from '../media/media.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ModerationTargetRegistry } from '../moderation/moderation-targets.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { UsersModule } from '../users/users.module.js';
import { VenuesModule } from '../venues/venues.module.js';
import { CrewsController, PublicCrewsController } from './crews.controller.js';
import { CrewChatGate } from './crews.gate.js';
import { CrewsHandlers } from './crews.handlers.js';
import { CrewsService } from './crews.service.js';

/** Recurring crews (Phase 8, F-ENG-02). */
@Module({
  imports: [
    AccountModule,
    ChatModule,
    EventsModule,
    MediaModule,
    ModerationModule,
    NotificationsModule,
    ProfilesModule,
    SocialGraphModule,
    UsersModule,
    VenuesModule,
  ],
  controllers: [CrewsController, PublicCrewsController],
  providers: [CrewsService, CrewChatGate, CrewsHandlers],
  exports: [CrewsService, CrewsHandlers],
})
export class CrewsModule implements OnModuleInit {
  constructor(
    private readonly crews: CrewsService,
    private readonly gate: CrewChatGate,
    private readonly gates: ConversationGates,
    private readonly hooks: EventHooks,
    private readonly accountData: AccountDataRegistry,
    private readonly moderationTargets: ModerationTargetRegistry,
  ) {}

  onModuleInit(): void {
    this.gates.register('crew', this.gate);
    this.moderationTargets.register({
      type: 'crew',
      preview: (id) => this.crews.moderationPreview(id),
      release: (id, tx) => this.crews.releaseHeld(id, tx),
      remove: (id, tx) => this.crews.removeForModeration(id, tx),
    });
    this.hooks.register({ crew: (eventId) => this.crews.crewOfEvent(eventId) });
    this.accountData.register({
      name: 'crews',
      export: (userId) => this.crews.exportFor(userId),
      erase: async (userId, tx) => {
        await this.crews.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
