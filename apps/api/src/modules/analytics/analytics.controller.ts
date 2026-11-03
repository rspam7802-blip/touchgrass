import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import { ClientAnalyticsBody } from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { AnalyticsService } from './analytics.service.js';

const Accepted = z.object({ accepted: z.number().int() });

/** App-side analytics (F-PLT-05): an allow-listed set of events, no personal data. */
@ApiTags('analytics')
@ApiBearerAuth()
@Controller({ path: 'analytics', version: '1' })
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Post('events')
  @HttpCode(202)
  @RateLimit({ name: 'analytics', limit: 120, windowSeconds: 3600, by: 'user' })
  @ApiZodBody(ClientAnalyticsBody)
  @ApiZodResponse(202, Accepted)
  async track(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(ClientAnalyticsBody)) body: Dto.ClientAnalyticsBody,
  ): Promise<z.infer<typeof Accepted>> {
    return { accepted: await this.analytics.trackClient(user.userId, body) };
  }
}
