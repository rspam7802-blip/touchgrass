import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  ConversationSummary,
  CreateCrewBody,
  CrewDetail,
  CrewHistory,
  CrewInviteBody,
  CrewList,
  CrewListQuery,
  CrewMemberActionBody,
  CrewMembershipBody,
  CrewRecurrenceBody,
  PaginationQuery,
  UpdateCrewBody,
  PublicCrewView,
} from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser, Public } from '../../common/auth/decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { ChatService } from '../chat/chat.service.js';
import { CrewsService } from './crews.service.js';

/** Recurring crews (F-ENG-02). */
@ApiTags('crews')
@ApiBearerAuth()
@Controller({ path: 'crews', version: '1' })
export class CrewsController {
  constructor(
    private readonly crews: CrewsService,
    private readonly chat: ChatService,
  ) {}

  @Get()
  @ApiZodQuery(CrewListQuery)
  @ApiZodResponse(200, CrewList)
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(CrewListQuery)) q: Dto.CrewListQuery,
  ): Promise<Dto.CrewList> {
    return this.crews.list(user.userId, q);
  }

  @Post()
  @Idempotent()
  @RateLimit({ name: 'crew-create', limit: 10, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(CreateCrewBody)
  @ApiZodResponse(201, CrewDetail)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(CreateCrewBody)) body: Dto.CreateCrewBody,
  ): Promise<Dto.CrewDetail> {
    return this.crews.create(user.userId, body);
  }

  @Get(':id')
  @ApiZodResponse(200, CrewDetail)
  detail(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.CrewDetail> {
    return this.crews.detail(user.userId, id);
  }

  @Patch(':id')
  @ApiZodBody(UpdateCrewBody)
  @ApiZodResponse(200, CrewDetail)
  update(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateCrewBody)) body: Dto.UpdateCrewBody,
  ): Promise<Dto.CrewDetail> {
    return this.crews.update(user.userId, id, body);
  }

  @Put(':id/schedule')
  @ApiZodBody(CrewRecurrenceBody)
  @ApiZodResponse(200, CrewDetail)
  schedule(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CrewRecurrenceBody)) body: Dto.CrewRecurrenceBody,
  ): Promise<Dto.CrewDetail> {
    return this.crews.setRecurrence(user.userId, id, body);
  }

  /** Join (or ask to), accept or decline an invite, leave. Returns the crew, or 204 once you're out. */
  @Post(':id/membership')
  @HttpCode(200)
  @RateLimit({ name: 'crew-membership', limit: 60, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(CrewMembershipBody)
  @ApiZodResponse(200, CrewDetail.nullable())
  async membership(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CrewMembershipBody)) body: Dto.CrewMembershipBody,
  ): Promise<Dto.CrewDetail | null> {
    return this.crews.membershipAction(user.userId, id, body);
  }

  @Post(':id/members/:userId')
  @HttpCode(200)
  @ApiZodBody(CrewMemberActionBody)
  @ApiZodResponse(200, CrewDetail)
  member(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body(new ZodPipe(CrewMemberActionBody)) body: Dto.CrewMemberActionBody,
  ): Promise<Dto.CrewDetail> {
    return this.crews.memberActionFor(user.userId, id, userId, body);
  }

  @Post(':id/invites')
  @HttpCode(200)
  @RateLimit({ name: 'crew-invite', limit: 100, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(CrewInviteBody)
  @ApiZodResponse(200, z.object({ invited: z.number().int() }))
  invite(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CrewInviteBody)) body: Dto.CrewInviteBody,
  ): Promise<{ invited: number }> {
    return this.crews.invite(user.userId, id, body.userIds);
  }

  @Get(':id/history')
  @ApiZodQuery(PaginationQuery)
  @ApiZodResponse(200, CrewHistory)
  history(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodPipe(PaginationQuery)) q: Dto.PaginationQuery,
  ): Promise<Dto.CrewHistory> {
    return this.crews.history(user.userId, id, q.cursor, q.limit);
  }

  @Get(':id/chat')
  @ApiZodResponse(200, ConversationSummary)
  chatFor(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.ConversationSummary> {
    return this.chat.crewConversation(user.userId, id);
  }
}

/** Shared crew links (F-GRW-02): open crews only, no login. */
@ApiTags('crews')
@Controller({ path: 'public/crews', version: '1' })
export class PublicCrewsController {
  constructor(private readonly crews: CrewsService) {}

  @Get(':id')
  @Public()
  @RateLimit({ name: 'public-crew', limit: 300, windowSeconds: 3600, by: 'ip' })
  @ApiZodResponse(200, PublicCrewView)
  async get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Dto.PublicCrewView> {
    const view = await this.crews.shareView(id);
    if (!view) throw AppError.notFound('Crew');
    return view;
  }
}
