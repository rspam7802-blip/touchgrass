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
  EventComment,
  EventCommentPage,
  EventCommentsQuery,
  PostCommentBody,
} from '@touchgrass/shared';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { EventCommentsService } from './event-comments.service.js';

/** Comments on plans (D-156). */
@ApiTags('events')
@ApiBearerAuth()
@Controller({ version: '1' })
export class EventCommentsController {
  constructor(private readonly comments: EventCommentsService) {}

  @Get('events/:id/comments')
  @ApiZodQuery(EventCommentsQuery)
  @ApiZodResponse(200, EventCommentPage)
  list(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query(new ZodPipe(EventCommentsQuery)) q: Dto.EventCommentsQuery,
  ): Promise<Dto.EventCommentPage> {
    return this.comments.list(user.userId, id, q);
  }

  @Post('events/:id/comments')
  @Idempotent()
  @RateLimit({ name: 'comment-post', limit: 10, windowSeconds: 60, by: 'user' })
  @ApiZodBody(PostCommentBody)
  @ApiZodResponse(201, EventComment)
  post(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PostCommentBody)) body: Dto.PostCommentBody,
  ): Promise<Dto.EventComment> {
    return this.comments.post(user.userId, id, body.body);
  }

  @Delete('comments/:commentId')
  @HttpCode(204)
  async remove(
    @CurrentUser() user: AuthPrincipal,
    @Param('commentId', new ParseUUIDPipe()) commentId: string,
  ): Promise<void> {
    await this.comments.remove(user.userId, commentId);
  }
}
