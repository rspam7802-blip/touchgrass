import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  AdminBadge,
  AdminBadgeList,
  AdminChallenge,
  AdminChallengeList,
  BadgeList,
  ChallengeList,
  JoinChallengeBody,
  Recap,
  RecapList,
  StreakView,
  UpsertBadgeBody,
  UpsertChallengeBody,
} from '@touchgrass/shared';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { ChallengesService } from './challenges.service.js';
import { GamificationService } from './gamification.service.js';
import { RecapsService } from './recaps.service.js';

/** Badges, streaks, challenges and recaps (F-GAM-01..04). */
@ApiTags('gamification')
@ApiBearerAuth()
@Controller({ version: '1' })
export class GamificationController {
  constructor(
    private readonly gamification: GamificationService,
    private readonly challenges: ChallengesService,
    private readonly recaps: RecapsService,
  ) {}

  @Get('me/badges')
  @ApiZodResponse(200, BadgeList)
  async badges(@CurrentUser() user: AuthPrincipal): Promise<Dto.BadgeList> {
    return { items: await this.gamification.myBadges(user.userId) };
  }

  @Get('me/streak')
  @ApiZodResponse(200, StreakView)
  streak(@CurrentUser() user: AuthPrincipal): Promise<Dto.StreakView> {
    return this.gamification.streak(user.userId);
  }

  @Get('challenges')
  @ApiZodResponse(200, ChallengeList)
  async challengeList(@CurrentUser() user: AuthPrincipal): Promise<Dto.ChallengeList> {
    return { items: await this.challenges.list(user.userId) };
  }

  @Post('challenges/:id/join')
  @HttpCode(200)
  @RateLimit({ name: 'challenge-join', limit: 30, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(JoinChallengeBody)
  @ApiZodResponse(200, ChallengeList)
  async join(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(JoinChallengeBody)) body: Dto.JoinChallengeBody,
  ): Promise<Dto.ChallengeList> {
    return { items: await this.challenges.join(user.userId, id, body) };
  }

  @Get('me/recaps')
  @ApiZodResponse(200, RecapList)
  async recapList(@CurrentUser() user: AuthPrincipal): Promise<Dto.RecapList> {
    return { items: await this.recaps.list(user.userId) };
  }

  @Get('me/recaps/:id')
  @ApiZodResponse(200, Recap)
  recap(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.Recap> {
    return this.recaps.get(user.userId, id);
  }
}

/** Admin: badge rules and challenges (F-WEB-03). Every change is audit-logged. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class GamificationAdminController {
  constructor(
    private readonly gamification: GamificationService,
    private readonly challenges: ChallengesService,
  ) {}

  @Get('badges')
  @Roles('admin', 'city_curator')
  @ApiZodResponse(200, AdminBadgeList)
  async badges(): Promise<{ items: Dto.AdminBadge[] }> {
    return { items: await this.gamification.adminList() };
  }

  @Post('badges')
  @Roles('admin')
  @ApiZodBody(UpsertBadgeBody)
  @ApiZodResponse(201, AdminBadge)
  createBadge(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(UpsertBadgeBody)) body: Dto.UpsertBadgeBody,
  ): Promise<Dto.AdminBadge> {
    return this.gamification.adminCreate(user.userId, body);
  }

  @Put('badges/:id')
  @Roles('admin')
  @ApiZodBody(UpsertBadgeBody)
  @ApiZodResponse(200, AdminBadge)
  updateBadge(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpsertBadgeBody)) body: Dto.UpsertBadgeBody,
  ): Promise<Dto.AdminBadge> {
    return this.gamification.adminUpdate(user.userId, id, body);
  }

  @Get('challenges')
  @Roles('admin', 'city_curator')
  @ApiZodResponse(200, AdminChallengeList)
  async challengeList(): Promise<{ items: Dto.AdminChallenge[] }> {
    return { items: await this.challenges.adminList() };
  }

  @Post('challenges')
  @Roles('admin', 'city_curator')
  @ApiZodBody(UpsertChallengeBody)
  @ApiZodResponse(201, AdminChallenge)
  createChallenge(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(UpsertChallengeBody)) body: Dto.UpsertChallengeBody,
  ): Promise<Dto.AdminChallenge> {
    return this.challenges.adminCreate(user.userId, body);
  }

  @Put('challenges/:id')
  @Roles('admin', 'city_curator')
  @ApiZodBody(UpsertChallengeBody)
  @ApiZodResponse(200, AdminChallenge)
  updateChallenge(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpsertChallengeBody)) body: Dto.UpsertChallengeBody,
  ): Promise<Dto.AdminChallenge> {
    return this.challenges.adminUpdate(user.userId, id, body);
  }
}
