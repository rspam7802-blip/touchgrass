import { Module } from '@nestjs/common';
import { ModerationTargetRegistry } from './moderation-targets.js';
import { ModerationService } from './moderation.service.js';
import { SanctionsReader } from './sanctions-reader.js';

/** DB-only moderation intake shared by every content module (flags, text screening, target registry, mutes). */
@Module({
  providers: [ModerationService, ModerationTargetRegistry, SanctionsReader],
  exports: [ModerationService, ModerationTargetRegistry, SanctionsReader],
})
export class ModerationModule {}
