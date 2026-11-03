import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventsModule } from '../events/events.module.js';
import { MediaModule } from '../media/media.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ModerationTargetRegistry } from '../moderation/moderation-targets.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { ReportTargetRegistry } from '../social/reports/report-targets.registry.js';
import { SocialModule } from '../social/social.module.js';
import { ChatPollsService } from './chat-polls.service.js';
import { ChatPresence } from './chat-presence.js';
import { ChatController, EventChatController, PollsController } from './chat.controller.js';
import { ChatHandlers } from './chat.handlers.js';
import { ChatService } from './chat.service.js';
import { ConversationGates, EventChatGate } from './conversation-gates.js';
import { PollsService } from './polls.service.js';

/** Chat (Phase 5, F-CHT-01..05): DMs + requests, event group chats, crew-chat gate slot, polls. */
@Module({
  imports: [
    AccountModule,
    EventsModule,
    MediaModule,
    ModerationModule,
    NotificationsModule,
    ProfilesModule,
    SocialGraphModule,
    SocialModule,
  ],
  controllers: [ChatController, PollsController, EventChatController],
  providers: [
    ChatService,
    ChatPollsService,
    PollsService,
    ConversationGates,
    EventChatGate,
    ChatPresence,
    ChatHandlers,
  ],
  exports: [
    ChatService,
    ChatPollsService,
    ChatPresence,
    ChatHandlers,
    ConversationGates,
    EventChatGate,
  ],
})
export class ChatModule implements OnModuleInit {
  constructor(
    private readonly gates: ConversationGates,
    private readonly eventGate: EventChatGate,
    private readonly chat: ChatService,
    private readonly polls: PollsService,
    private readonly targets: ReportTargetRegistry,
    private readonly moderationTargets: ModerationTargetRegistry,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.gates.register('event', this.eventGate);
    this.targets.register({
      type: 'message',
      resolve: (reporterId, id) => this.chat.reportTarget(reporterId, id),
    });
    this.moderationTargets.register({
      type: 'message',
      preview: (id) => this.chat.moderationPreview(id),
      release: (id, tx) => this.chat.releaseHeld(id, tx),
      remove: (id, tx) => this.chat.removeForModeration(id, tx),
    });
    this.accountData.register({
      name: 'chat',
      export: (userId) => this.chat.exportFor(userId),
      erase: async (userId, tx) => {
        await this.polls.eraseVotes(userId, tx);
        await this.chat.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
