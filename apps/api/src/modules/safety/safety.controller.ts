import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  LocationPointBody,
  MyLiveShare,
  PublicLiveView,
  SosBody,
  StartShareBody,
  TrustedContactBody,
  TrustedContactList,
} from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { SafetyService } from './safety.service.js';

const LiveToken = z.string().regex(/^[0-9a-f-]{36}\.\d{1,12}\.[A-Za-z0-9_-]{43}$/);

/** Trusted contacts, live location and SOS (F-SAF-04). */
@ApiTags('safety')
@ApiBearerAuth()
@Controller({ path: 'safety', version: '1' })
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}

  @Get('contacts')
  @ApiZodResponse(200, TrustedContactList)
  async contacts(@CurrentUser() user: AuthPrincipal): Promise<Dto.TrustedContactList> {
    return { items: await this.safety.contacts(user.userId) };
  }

  @Post('contacts')
  @HttpCode(200)
  @Idempotent()
  @RateLimit({ name: 'trusted-contacts', limit: 20, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(TrustedContactBody)
  @ApiZodResponse(200, TrustedContactList)
  async addContact(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(TrustedContactBody)) body: Dto.TrustedContactBody,
  ): Promise<Dto.TrustedContactList> {
    return { items: await this.safety.addContact(user.userId, body) };
  }

  @Delete('contacts/:id')
  @ApiZodResponse(200, TrustedContactList)
  async removeContact(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.TrustedContactList> {
    return { items: await this.safety.removeContact(user.userId, id) };
  }

  @Get('live')
  @ApiZodResponse(200, MyLiveShare)
  async live(@CurrentUser() user: AuthPrincipal): Promise<Dto.MyLiveShare> {
    return { share: await this.safety.mine(user.userId) };
  }

  @Post('live')
  @HttpCode(200)
  @Idempotent()
  // Each start texts every contact: keep it well clear of SMS abuse.
  @RateLimit({ name: 'live-start', limit: 10, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(StartShareBody)
  @ApiZodResponse(200, MyLiveShare)
  async start(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(StartShareBody)) body: Dto.StartShareBody,
  ): Promise<Dto.MyLiveShare> {
    return { share: await this.safety.start(user.userId, body) };
  }

  @Post('live/points')
  @HttpCode(200)
  @RateLimit({ name: 'live-points', limit: 30, windowSeconds: 60, by: 'user' })
  @ApiZodBody(LocationPointBody)
  @ApiZodResponse(200, MyLiveShare)
  async point(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(LocationPointBody)) body: Dto.LocationPointBody,
  ): Promise<Dto.MyLiveShare> {
    return { share: await this.safety.addPoint(user.userId, body) };
  }

  @Post('live/stop')
  @HttpCode(200)
  @ApiZodResponse(200, MyLiveShare)
  async stop(@CurrentUser() user: AuthPrincipal): Promise<Dto.MyLiveShare> {
    return { share: await this.safety.stop(user.userId) };
  }

  @Post('sos')
  @HttpCode(200)
  @Idempotent()
  @RateLimit({ name: 'sos', limit: 10, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(SosBody)
  @ApiZodResponse(200, MyLiveShare)
  async sos(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(SosBody)) body: Dto.SosBody,
  ): Promise<Dto.MyLiveShare> {
    return { share: await this.safety.sos(user.userId, body) };
  }
}

/** The page trusted contacts open (F-WEB-02): no login, signed expiring link. */
@ApiTags('safety')
@Controller({ path: 'live', version: '1' })
export class PublicLiveController {
  constructor(private readonly safety: SafetyService) {}

  @Get(':token')
  @Public()
  @RateLimit({ name: 'live-view', limit: 600, windowSeconds: 3600, by: 'ip' })
  @ApiZodResponse(200, PublicLiveView)
  view(@Param('token', new ZodPipe(LiveToken)) token: string): Promise<Dto.PublicLiveView> {
    return this.safety.publicView(token);
  }
}
