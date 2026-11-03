import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InterestList, VibeTagList } from '@touchgrass/shared';
import type { z } from 'zod';
import { AllowOnboarding, Public } from '../../common/auth/decorators.js';
import { ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { InterestsService } from './interests.service.js';

@ApiTags('catalog')
@Public()
@AllowOnboarding()
@Controller({ version: '1' })
export class InterestsController {
  constructor(private readonly interests: InterestsService) {}

  @Get('interests')
  @ApiZodResponse(200, InterestList)
  async listInterests(): Promise<z.infer<typeof InterestList>> {
    return { items: await this.interests.listInterests() };
  }

  @Get('vibe-tags')
  @ApiZodResponse(200, VibeTagList)
  async listVibes(): Promise<z.infer<typeof VibeTagList>> {
    return { items: await this.interests.listVibeTags() };
  }
}
