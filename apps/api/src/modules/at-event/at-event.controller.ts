import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  EventSignal,
  IcebreakerCard,
  IcebreakerDeck,
  NewcomerList,
  PushIcebreakerBody,
  UpsertIcebreakerBody,
  WelcomeBody,
} from '@touchgrass/shared';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AtEventService } from './at-event.service.js';

@ApiTags('at-event')
@ApiBearerAuth()
@Controller({ path: 'events', version: '1' })
export class AtEventController {
  constructor(private readonly atEvent: AtEventService) {}

  @Get(':id/icebreakers')
  @ApiZodResponse(200, IcebreakerDeck)
  deck(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.IcebreakerDeck> {
    return this.atEvent.deckFor(user.userId, id);
  }

  @Post(':id/icebreakers/push')
  @HttpCode(200)
  @RateLimit({ name: 'icebreaker-push', limit: 30, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(PushIcebreakerBody)
  @ApiZodResponse(200, IcebreakerCard)
  push(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PushIcebreakerBody)) body: Dto.PushIcebreakerBody,
  ): Promise<Dto.IcebreakerCard> {
    return this.atEvent.push(user.userId, id, body.cardId);
  }

  @Get(':id/signal')
  @ApiZodResponse(200, EventSignal)
  signal(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.EventSignal> {
    return this.atEvent.signal(user.userId, id);
  }

  @Get(':id/newcomers')
  @ApiZodResponse(200, NewcomerList)
  newcomers(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.NewcomerList> {
    return this.atEvent.newcomers(user.userId, id);
  }

  @Put(':id/newcomers/:userId')
  @ApiZodBody(WelcomeBody)
  @ApiZodResponse(200, NewcomerList)
  welcome(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodPipe(WelcomeBody)) body: Dto.WelcomeBody,
  ): Promise<Dto.NewcomerList> {
    return this.atEvent.welcome(user.userId, id, userId, body.welcomed);
  }
}

/** Icebreaker deck management (admin dashboard). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin/icebreakers', version: '1' })
export class IcebreakerAdminController {
  constructor(
    private readonly atEvent: AtEventService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('admin', 'city_curator')
  @ApiZodResponse(200, IcebreakerDeck)
  list(): Promise<Dto.IcebreakerDeck> {
    return this.atEvent.adminList();
  }

  @Post()
  @Roles('admin', 'city_curator')
  @ApiZodBody(UpsertIcebreakerBody)
  @ApiZodResponse(201, IcebreakerCard)
  async create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(UpsertIcebreakerBody)) body: Dto.UpsertIcebreakerBody,
  ): Promise<Dto.IcebreakerCard> {
    const card = await this.atEvent.adminCreate(body);
    await this.audit.record({
      adminUserId: user.userId,
      action: 'icebreaker.create',
      targetType: 'icebreaker',
      targetId: card.id,
      details: { category: card.category },
    });
    return card;
  }

  @Put(':id')
  @Roles('admin', 'city_curator')
  @ApiZodBody(UpsertIcebreakerBody)
  @ApiZodResponse(200, IcebreakerCard)
  async update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpsertIcebreakerBody)) body: Dto.UpsertIcebreakerBody,
  ): Promise<Dto.IcebreakerCard> {
    const card = await this.atEvent.adminUpdate(id, body);
    await this.audit.record({
      adminUserId: user.userId,
      action: 'icebreaker.update',
      targetType: 'icebreaker',
      targetId: id,
      details: { active: card.active },
    });
    return card;
  }
}
