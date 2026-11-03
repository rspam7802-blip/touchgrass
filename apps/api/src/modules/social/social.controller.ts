import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  ActivityFeed,
  BlockBody,
  BlockedList,
  ContactMatchBody,
  ContactMatchResponse,
  CreateReportBody,
  FriendRequestBody,
  FriendRequestList,
  FriendRequestResult,
  PaginationQuery,
  PersonList,
  ReportCreated,
  SuggestionList,
} from '@touchgrass/shared';
import type { z } from 'zod';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { ActivityService } from './activity/activity.service.js';
import { SocialGraphService } from './graph/social-graph.service.js';
import { ReportsService } from './reports/reports.service.js';
import { SocialService } from './social.service.js';

@ApiTags('social')
@ApiBearerAuth()
@Controller({ path: 'social', version: '1' })
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly graph: SocialGraphService,
    private readonly profiles: ProfilesService,
  ) {}

  @Get('squad')
  @ApiZodQuery(PaginationQuery)
  @ApiZodResponse(200, PersonList)
  squad(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(PaginationQuery)) q: Dto.PaginationQuery,
  ): Promise<Dto.PersonList> {
    return this.social.squad(user.userId, q.cursor, q.limit);
  }

  @Delete('squad/:userId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.graph.removeFriend(user.userId, userId);
  }

  @Get('requests')
  @ApiZodResponse(200, FriendRequestList)
  async requests(@CurrentUser() user: AuthPrincipal): Promise<z.infer<typeof FriendRequestList>> {
    return { items: await this.social.requests(user.userId) };
  }

  @Post('requests')
  @HttpCode(200)
  @Idempotent()
  @RateLimit({ name: 'friend-request', limit: 50, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(FriendRequestBody)
  @ApiZodResponse(200, FriendRequestResult)
  async request(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(FriendRequestBody)) body: Dto.FriendRequestBody,
  ): Promise<Dto.FriendRequestResult> {
    return { relationship: await this.graph.request(user.userId, body.userId) };
  }

  @Post('requests/:userId/accept')
  @HttpCode(200)
  @ApiZodResponse(200, FriendRequestResult)
  async accept(
    @CurrentUser() user: AuthPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<Dto.FriendRequestResult> {
    return { relationship: await this.graph.respond(user.userId, userId, true) };
  }

  @Post('requests/:userId/decline')
  @HttpCode(200)
  @ApiZodResponse(200, FriendRequestResult)
  async decline(
    @CurrentUser() user: AuthPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<Dto.FriendRequestResult> {
    return { relationship: await this.graph.respond(user.userId, userId, false) };
  }

  @Delete('requests/:userId')
  @HttpCode(204)
  async cancel(
    @CurrentUser() user: AuthPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.graph.cancelRequest(user.userId, userId);
  }

  @Get('suggestions')
  @ApiZodResponse(200, SuggestionList)
  async suggestions(@CurrentUser() user: AuthPrincipal): Promise<z.infer<typeof SuggestionList>> {
    return { items: await this.social.suggestions(user.userId) };
  }

  @Post('suggestions/:userId/dismiss')
  @HttpCode(204)
  async dismiss(
    @CurrentUser() user: AuthPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.graph.dismiss(user.userId, userId);
  }

  @Post('contacts/match')
  @HttpCode(200)
  @RateLimit({ name: 'contacts-match', limit: 10, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(ContactMatchBody)
  @ApiZodResponse(200, ContactMatchResponse)
  async contacts(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(ContactMatchBody)) body: Dto.ContactMatchBody,
  ): Promise<Dto.ContactMatchResponse> {
    return { items: await this.social.matchContacts(user.userId, body.hashes) };
  }

  @Get('blocks')
  @ApiZodResponse(200, BlockedList)
  async blocked(@CurrentUser() user: AuthPrincipal): Promise<Dto.BlockedList> {
    const rows = await this.graph.blockedByMe(user.userId);
    const names = await this.profiles.displayNames(rows.map((r) => r.id));
    return {
      items: rows.map((r) => ({
        id: r.id,
        displayName: names.get(r.id) ?? '',
        blockedAt: r.blockedAt.toISOString(),
      })),
    };
  }

  @Post('blocks')
  @HttpCode(204)
  @RateLimit({ name: 'block', limit: 100, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(BlockBody)
  async block(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(BlockBody)) body: Dto.BlockBody,
  ): Promise<void> {
    await this.graph.block(user.userId, body.userId);
  }

  @Delete('blocks/:userId')
  @HttpCode(204)
  async unblock(
    @CurrentUser() user: AuthPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<void> {
    await this.graph.unblock(user.userId, userId);
  }
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @Idempotent()
  @RateLimit({ name: 'report', limit: 20, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(CreateReportBody)
  @ApiZodResponse(201, ReportCreated)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(CreateReportBody)) body: Dto.CreateReportBody,
  ): Promise<z.infer<typeof ReportCreated>> {
    return this.reports.create(user.userId, body);
  }
}

@ApiTags('activity')
@ApiBearerAuth()
@Controller({ path: 'activity', version: '1' })
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @ApiZodQuery(PaginationQuery)
  @ApiZodResponse(200, ActivityFeed)
  feed(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(PaginationQuery)) q: Dto.PaginationQuery,
  ): Promise<Dto.ActivityFeed> {
    return this.activity.feed(user.userId, q.cursor, q.limit);
  }
}
