import { Module, type OnModuleInit } from '@nestjs/common';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ModerationTargetRegistry } from '../moderation/moderation-targets.js';
import { MediaController } from './media.controller.js';
import { MediaProcessor } from './media.processor.js';
import { MediaService } from './media.service.js';
import { VideoTranscoder } from './video.js';

@Module({
  imports: [ModerationModule],
  controllers: [MediaController],
  providers: [MediaService, MediaProcessor, VideoTranscoder],
  exports: [MediaService, MediaProcessor],
})
export class MediaModule implements OnModuleInit {
  constructor(
    private readonly media: MediaService,
    private readonly moderationTargets: ModerationTargetRegistry,
  ) {}

  onModuleInit(): void {
    // Images held by automatic moderation (profile photos, chat images, Lore, covers, selfies).
    this.moderationTargets.register({
      type: 'media_asset',
      preview: (id) => this.media.moderationPreview(id),
      release: (id, tx) => this.media.releaseFlagged(id, tx),
      remove: (id, tx) => this.media.removeForModeration(id, tx),
    });
  }
}
