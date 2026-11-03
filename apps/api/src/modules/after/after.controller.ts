import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import { PendingPostEvent, PostEventCard, PullResult, ReconnectList } from '@touchgrass/shared';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { AfterService } from './after.service.js';

/** After the plan (F-AFT-01, F-AFT-03). */
@ApiTags('after')
@ApiBearerAuth()
@Controller({ version: '1' })
export class AfterController {
  constructor(private readonly after: AfterService) {}

  @Get('me/after')
  @ApiZodResponse(200, PendingPostEvent)
  async pending(@CurrentUser() user: AuthPrincipal): Promise<Dto.PendingPostEvent> {
    return { card: await this.after.pending(user.userId) };
  }

  @Get('events/:id/after')
  @ApiZodResponse(200, PostEventCard)
  card(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.PostEventCard> {
    return this.after.card(user.userId, id);
  }

  @Post('events/:id/after/dismiss')
  @HttpCode(204)
  async dismiss(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.after.dismiss(user.userId, id);
  }

  @Get('events/:id/people')
  @ApiZodResponse(200, ReconnectList)
  async people(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.ReconnectList> {
    return { items: await this.after.peopleYouMet(user.userId, id) };
  }

  @Post('events/:id/people/:userId/pull')
  @HttpCode(200)
  @RateLimit({ name: 'reconnect-pull', limit: 100, windowSeconds: 86_400, by: 'user' })
  @ApiZodResponse(200, PullResult)
  async pull(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<Dto.PullResult> {
    return { state: await this.after.pull(user.userId, id, userId) };
  }
}
