import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  AdminVerification,
  AdminVerificationList,
  MyVerification,
  PaginationQuery,
  ReviewVerificationBody,
  SubmitVerificationBody,
} from '@touchgrass/shared';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { VerificationService } from './verification.service.js';

/** Selfie verification (F-SAF-01). */
@ApiTags('safety')
@ApiBearerAuth()
@Controller({ path: 'verification', version: '1' })
export class VerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  @ApiZodResponse(200, MyVerification)
  mine(@CurrentUser() user: AuthPrincipal): Promise<Dto.MyVerification> {
    return this.verification.mine(user.userId);
  }

  @Post('challenge')
  @HttpCode(200)
  @RateLimit({ name: 'verification-challenge', limit: 10, windowSeconds: 86_400, by: 'user' })
  @ApiZodResponse(200, MyVerification)
  start(@CurrentUser() user: AuthPrincipal): Promise<Dto.MyVerification> {
    return this.verification.start(user.userId);
  }

  @Post('submit')
  @HttpCode(200)
  @Idempotent()
  @RateLimit({ name: 'verification-submit', limit: 10, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(SubmitVerificationBody)
  @ApiZodResponse(200, MyVerification)
  submit(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(SubmitVerificationBody)) body: Dto.SubmitVerificationBody,
  ): Promise<Dto.MyVerification> {
    return this.verification.submit(user.userId, body);
  }
}

/** The review queue (F-SAF-01, F-WEB-03). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin/verifications', version: '1' })
export class AdminVerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Get()
  @Roles('moderator', 'admin')
  @ApiZodQuery(PaginationQuery)
  @ApiZodResponse(200, AdminVerificationList)
  queue(
    @Query(new ZodPipe(PaginationQuery)) q: Dto.PaginationQuery,
  ): Promise<Dto.AdminVerificationList> {
    return this.verification.queue(q.cursor, q.limit);
  }

  @Post(':id/review')
  @HttpCode(200)
  @Roles('moderator', 'admin')
  @Idempotent()
  @ApiZodBody(ReviewVerificationBody)
  @ApiZodResponse(200, AdminVerification)
  review(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ReviewVerificationBody)) body: Dto.ReviewVerificationBody,
  ): Promise<Dto.AdminVerification> {
    return this.verification.review(admin.userId, id, body);
  }
}
