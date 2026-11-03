import type * as Dto from '@touchgrass/shared';
import { Body, Controller, Delete, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CityWaitlistStatus, JoinCityWaitlistBody } from '@touchgrass/shared';
import { AllowOnboarding, CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { CityWaitlistService } from './city-waitlist.service.js';

/** Waiting for your city to open (F-GRW-03). Reachable while still onboarding. */
@ApiTags('catalog')
@ApiBearerAuth()
@AllowOnboarding()
@Controller({ path: 'cities/waitlist', version: '1' })
export class CityWaitlistController {
  constructor(private readonly waitlist: CityWaitlistService) {}

  @Get()
  @ApiZodResponse(200, CityWaitlistStatus)
  async status(@CurrentUser() me: AuthPrincipal): Promise<Dto.CityWaitlistStatus> {
    return this.waitlist.status(me.userId);
  }

  @Post()
  @HttpCode(200)
  @RateLimit({ name: 'city-waitlist', limit: 10, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(JoinCityWaitlistBody)
  @ApiZodResponse(200, CityWaitlistStatus)
  async join(
    @CurrentUser() me: AuthPrincipal,
    @Body(new ZodPipe(JoinCityWaitlistBody)) body: Dto.JoinCityWaitlistBody,
  ): Promise<Dto.CityWaitlistStatus> {
    return this.waitlist.join(me.userId, body);
  }

  @Delete()
  @HttpCode(204)
  async leave(@CurrentUser() me: AuthPrincipal): Promise<void> {
    await this.waitlist.leave(me.userId);
  }
}
