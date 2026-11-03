import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventsModule } from '../events/events.module.js';
import { FeedbackReader } from '../hosting/feedback-reader.js';
import { HostingModule } from '../hosting/hosting.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { FeedbackAdminController, FeedbackController } from './feedback.controller.js';
import { FeedbackService } from './feedback.service.js';
import { HostRatingReaderModule } from './host-rating-reader.js';

/** Event feedback and host ratings (Phase 7, F-AFT-02, F-AFT-05). */
@Module({
  imports: [AccountModule, EventsModule, HostingModule, HostRatingReaderModule, ProfilesModule],
  controllers: [FeedbackController, FeedbackAdminController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule implements OnModuleInit {
  constructor(
    private readonly feedback: FeedbackService,
    private readonly reader: FeedbackReader,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    // Host insights (Phase 6) read ratings and themes from here.
    this.reader.register({ summaries: (ids) => this.feedback.summaries(ids) });
    this.accountData.register({
      name: 'feedback',
      export: (userId) => this.feedback.exportFor(userId),
      erase: async (userId, tx) => {
        await this.feedback.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
