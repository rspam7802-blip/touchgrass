import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import { MyReferrals, PriorityPassResult } from '@touchgrass/shared';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ReferralsService } from './referrals.service.js';

/** Referral rewards (F-GRW-01). */
@ApiTags('referrals')
@ApiBearerAuth()
@Controller({ version: '1' })
export class ReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get('me/referrals')
  @ApiZodResponse(200, MyReferrals)
  mine(@CurrentUser() user: AuthPrincipal): Promise<Dto.MyReferrals> {
    return this.referrals.mine(user.userId);
  }

  @Post('events/:id/priority-pass')
  @HttpCode(200)
  @Idempotent()
  @RateLimit({ name: 'priority-pass', limit: 20, windowSeconds: 3600, by: 'user' })
  @ApiZodResponse(200, PriorityPassResult)
  async usePass(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.PriorityPassResult> {
    return { position: await this.referrals.usePriorityPass(user.userId, id) };
  }
}
