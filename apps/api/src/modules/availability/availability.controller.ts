import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import { FreeNowList, MyAvailability, SetAvailabilityBody } from '@touchgrass/shared';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { AvailabilityService } from './availability.service.js';

/** "I'm free now" (F-ENG-01). */
@ApiTags('availability')
@ApiBearerAuth()
@Controller({ path: 'me/availability', version: '1' })
export class AvailabilityController {
  constructor(private readonly availability: AvailabilityService) {}

  @Get()
  @ApiZodResponse(200, FreeNowList)
  squad(@CurrentUser() user: AuthPrincipal): Promise<Dto.FreeNowList> {
    return this.availability.squadFree(user.userId);
  }

  @Put()
  @RateLimit({ name: 'availability-set', limit: 20, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(SetAvailabilityBody)
  @ApiZodResponse(200, MyAvailability)
  set(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(SetAvailabilityBody)) body: Dto.SetAvailabilityBody,
  ): Promise<Dto.MyAvailability> {
    return this.availability.set(user.userId, body);
  }

  @Delete()
  @HttpCode(204)
  async clear(@CurrentUser() user: AuthPrincipal): Promise<void> {
    await this.availability.clear(user.userId);
  }
}

/** Pinging a squad member who is free now (F-ENG-01, Phase 13). */
@ApiTags('availability')
@ApiBearerAuth()
@Controller({ path: 'availability', version: '1' })
export class AvailabilityPingController {
  constructor(private readonly availability: AvailabilityService) {}

  @Post(':userId/ping')
  @HttpCode(204)
  @RateLimit({ name: 'availability-ping', limit: 30, windowSeconds: 3600, by: 'user' })
  async ping(
    @CurrentUser() user: AuthPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.availability.ping(user.userId, userId);
  }
}
