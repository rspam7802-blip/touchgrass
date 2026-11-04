import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventsModule } from '../events/events.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ModerationTargetRegistry } from '../moderation/moderation-targets.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { ReportTargetRegistry } from '../social/reports/report-targets.registry.js';
import { SocialModule } from '../social/social.module.js';
import { EventCommentsController } from './event-comments.controller.js';
import { EventCommentsHandlers } from './event-comments.handlers.js';
import { EventCommentsService } from './event-comments.service.js';

/** Comments on plans (D-156). */
@Module({
  imports: [
    AccountModule,
    EventsModule,
    ModerationModule,
    NotificationsModule,
    ProfilesModule,
    SocialGraphModule,
    SocialModule,
  ],
  controllers: [EventCommentsController],
  providers: [EventCommentsService, EventCommentsHandlers],
  exports: [EventCommentsService, EventCommentsHandlers],
})
export class EventCommentsModule implements OnModuleInit {
  constructor(
    private readonly comments: EventCommentsService,
    private readonly targets: ReportTargetRegistry,
    private readonly moderationTargets: ModerationTargetRegistry,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.targets.register({
      type: 'event_comment',
      resolve: (reporterId, id) => this.comments.reportTarget(reporterId, id),
    });
    this.moderationTargets.register({
      type: 'event_comment',
      preview: (id) => this.comments.moderationPreview(id),
      release: (id, tx) => this.comments.release(id, tx),
      remove: (id, tx) => this.comments.removeForModeration(id, tx),
    });
    this.accountData.register({
      name: 'eventComments',
      export: (userId) => this.comments.exportFor(userId),
      erase: async (userId, tx) => {
        await this.comments.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
