import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AllowOnboarding, Public } from '../../common/auth/decorators.js';
import { AppConfigResponse } from '@touchgrass/shared';
import { ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { FeatureFlagsService } from './feature-flags.service.js';

/** Read by the mobile app at startup: feature flags and the forced/optional update thresholds (F-PLT-01/02). */
@Public()
@AllowOnboarding()
@ApiTags('platform')
@Controller({ path: 'app', version: '1' })
export class AppConfigController {
  constructor(
    private readonly flags: FeatureFlagsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('config')
  @ApiZodResponse(200, AppConfigResponse)
  async config(): Promise<AppConfigResponse> {
    return {
      minSupportedVersion: this.env.MIN_SUPPORTED_APP_VERSION,
      latestVersion: this.env.LATEST_APP_VERSION,
      flags: await this.flags.all(),
    };
  }
}
