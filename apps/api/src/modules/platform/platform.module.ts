import { Module } from '@nestjs/common';
import { AppConfigController } from './app-config.controller.js';
import { AppSettingsService } from './app-settings.service.js';
import { FeatureFlagsService } from './feature-flags.service.js';

@Module({
  controllers: [AppConfigController],
  providers: [FeatureFlagsService, AppSettingsService],
  exports: [FeatureFlagsService, AppSettingsService],
})
export class PlatformModule {}
