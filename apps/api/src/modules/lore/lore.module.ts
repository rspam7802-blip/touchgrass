import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventHooks } from '../events/event-hooks.js';
import { EventsModule } from '../events/events.module.js';
import { MediaModule } from '../media/media.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ModerationTargetRegistry } from '../moderation/moderation-targets.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { ReportTargetRegistry } from '../social/reports/report-targets.registry.js';
import { SocialModule } from '../social/social.module.js';
import { LoreController } from './lore.controller.js';
import { LoreHandlers } from './lore.handlers.js';
import { LoreService } from './lore.service.js';

/** Lore albums (Phase 7, F-AFT-04). */
@Module({
  imports: [
    AccountModule,
    EventsModule,
    MediaModule,
    ModerationModule,
    ProfilesModule,
    SocialGraphModule,
    SocialModule,
  ],
  controllers: [LoreController],
  providers: [LoreService, LoreHandlers],
  exports: [LoreService, LoreHandlers],
})
export class LoreModule implements OnModuleInit {
  constructor(
    private readonly lore: LoreService,
    private readonly hooks: EventHooks,
    private readonly targets: ReportTargetRegistry,
    private readonly moderationTargets: ModerationTargetRegistry,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.hooks.register({
      lore: (userId, core, facts) => this.lore.summaryFor(userId, core, facts),
    });
    this.targets.register({
      type: 'lore_media',
      resolve: (reporterId, id) => this.lore.reportTarget(reporterId, id),
    });
    this.moderationTargets.register({
      type: 'lore_media',
      preview: (id) => this.lore.moderationPreview(id),
      release: (id, tx) => this.lore.releaseCaption(id, tx),
      remove: (id, tx) => this.lore.removeForModeration(id, tx),
    });
    this.accountData.register({
      name: 'lore',
      export: (userId) => this.lore.exportFor(userId),
      erase: async (userId, tx) => {
        await this.lore.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
