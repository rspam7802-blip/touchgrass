import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { MediaModule } from '../media/media.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ModerationTargetRegistry } from '../moderation/moderation-targets.js';
import { PlatformModule } from '../platform/platform.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { ReportTargetRegistry } from '../social/reports/report-targets.registry.js';
import { SocialModule } from '../social/social.module.js';
import { StoriesController } from './stories.controller.js';
import { StoriesService } from './stories.service.js';

/** Squad stories (Phase 13). */
@Module({
  imports: [
    AccountModule,
    MediaModule,
    ModerationModule,
    PlatformModule,
    ProfilesModule,
    SocialGraphModule,
    SocialModule,
  ],
  controllers: [StoriesController],
  providers: [StoriesService],
  exports: [StoriesService],
})
export class StoriesModule implements OnModuleInit {
  constructor(
    private readonly stories: StoriesService,
    private readonly targets: ReportTargetRegistry,
    private readonly moderationTargets: ModerationTargetRegistry,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.targets.register({
      type: 'story',
      resolve: (reporterId, id) => this.stories.reportTarget(reporterId, id),
    });
    this.moderationTargets.register({
      type: 'story',
      preview: (id) => this.stories.moderationPreview(id),
      release: (id, tx) => this.stories.release(id, tx),
      remove: (id, tx) => this.stories.removeForModeration(id, tx),
    });
    this.accountData.register({
      name: 'stories',
      export: (userId) => this.stories.exportFor(userId),
      erase: async (userId, tx) => {
        await this.stories.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
