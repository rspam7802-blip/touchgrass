import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventsModule } from '../events/events.module.js';
import { FeedbackModule } from '../feedback/feedback.module.js';
import { LoreModule } from '../lore/lore.module.js';
import { MediaModule } from '../media/media.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { AfterController } from './after.controller.js';
import { AfterService } from './after.service.js';
import { BadgesReader } from './badges-reader.js';

/** After the plan (Phase 7, F-AFT-01, F-AFT-03): post-event card, people you met, mutual pull. */
@Module({
  imports: [
    AccountModule,
    EventsModule,
    FeedbackModule,
    LoreModule,
    MediaModule,
    ProfilesModule,
    SocialGraphModule,
  ],
  controllers: [AfterController],
  providers: [AfterService, BadgesReader],
  exports: [AfterService, BadgesReader],
})
export class AfterModule implements OnModuleInit {
  constructor(
    private readonly after: AfterService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.accountData.register({
      name: 'after',
      export: (userId) => this.after.exportFor(userId),
      erase: async (userId, tx) => {
        await this.after.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
