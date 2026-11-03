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
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  PersonStories,
  PostStoryBody,
  StoryTray,
  StoryViewersPage,
  StoryViewersQuery,
} from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { StoriesService } from './stories.service.js';

/** Squad stories (Phase 13). */
@ApiTags('stories')
@ApiBearerAuth()
@Controller({ version: '1' })
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Get('stories')
  @ApiZodResponse(200, StoryTray)
  tray(@CurrentUser() user: AuthPrincipal): Promise<Dto.StoryTray> {
    return this.stories.tray(user.userId);
  }

  @Post('stories')
  @Idempotent()
  @RateLimit({ name: 'story-post', limit: 40, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(PostStoryBody)
  @ApiZodResponse(201, z.object({ id: z.uuid() }))
  post(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(PostStoryBody)) body: Dto.PostStoryBody,
  ): Promise<{ id: string }> {
    return this.stories.post(user.userId, body);
  }

  @Get('users/:userId/stories')
  @ApiZodResponse(200, PersonStories)
  forPerson(
    @CurrentUser() user: AuthPrincipal,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<Dto.PersonStories> {
    return this.stories.forPerson(user.userId, userId);
  }

  @Post('stories/:id/view')
  @HttpCode(204)
  @RateLimit({ name: 'story-view', limit: 600, windowSeconds: 3600, by: 'user' })
  async view(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.stories.markViewed(user.userId, id);
  }

  @Put('stories/:id/like')
  @HttpCode(204)
  @RateLimit({ name: 'story-like', limit: 60, windowSeconds: 60, by: 'user' })
  async like(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.stories.like(user.userId, id);
  }

  @Delete('stories/:id/like')
  @HttpCode(204)
  @RateLimit({ name: 'story-like', limit: 60, windowSeconds: 60, by: 'user' })
  async unlike(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.stories.unlike(user.userId, id);
  }

  @Get('stories/:id/viewers')
  @ApiZodQuery(StoryViewersQuery)
  @ApiZodResponse(200, StoryViewersPage)
  viewers(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodPipe(StoryViewersQuery)) q: Dto.StoryViewersQuery,
  ): Promise<Dto.StoryViewersPage> {
    return this.stories.viewers(user.userId, id, q);
  }

  @Delete('stories/:id')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.stories.remove(user.userId, id);
  }
}
