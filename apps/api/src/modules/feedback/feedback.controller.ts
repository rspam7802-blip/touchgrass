import { Body, Controller, Get, Param, ParseUUIDPipe, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  AdminFeedbackList,
  AdminFeedbackQuery,
  FeedbackBody,
  FeedbackSummary,
  MyFeedback,
} from '@touchgrass/shared';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { FeedbackService } from './feedback.service.js';

/** Rating a plan and its host (F-AFT-02, F-AFT-05); hosts read the aggregate. */
@ApiTags('feedback')
@ApiBearerAuth()
@Controller({ path: 'events', version: '1' })
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Put(':id/feedback')
  @RateLimit({ name: 'feedback', limit: 30, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(FeedbackBody)
  @ApiZodResponse(200, MyFeedback)
  submit(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(FeedbackBody)) body: Dto.FeedbackBody,
  ): Promise<Dto.MyFeedback> {
    return this.feedback.submit(user.userId, id, body);
  }

  @Get(':id/feedback/summary')
  @ApiZodResponse(200, FeedbackSummary)
  summary(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.FeedbackSummary> {
    return this.feedback.summary(user.userId, id);
  }
}

/** Feedback across plans for the admin dashboard. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin/feedback', version: '1' })
export class FeedbackAdminController {
  constructor(private readonly feedback: FeedbackService) {}

  @Get()
  @Roles('admin', 'city_curator', 'moderator')
  @ApiZodQuery(AdminFeedbackQuery)
  @ApiZodResponse(200, AdminFeedbackList)
  list(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(AdminFeedbackQuery)) q: Dto.AdminFeedbackQuery,
  ): Promise<{ items: Dto.AdminFeedbackRow[]; nextCursor: string | null }> {
    return this.feedback.adminList(user.userId, q);
  }
}
