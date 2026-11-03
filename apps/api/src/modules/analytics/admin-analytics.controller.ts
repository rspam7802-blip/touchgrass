import type * as Dto from '@touchgrass/shared';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ADMIN_SECTIONS, AnalyticsOverview, AnalyticsOverviewQuery } from '@touchgrass/shared';
import { AdminScopeService } from '../../common/auth/admin-scope.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { AnalyticsCountersService } from './analytics-counters.service.js';

/** Admin dashboard → analytics overview (F-WEB-03). Curators see their cities only. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(...ADMIN_SECTIONS.analytics)
@Controller({ path: 'admin/analytics', version: '1' })
export class AdminAnalyticsController {
  constructor(
    private readonly counters: AnalyticsCountersService,
    private readonly scope: AdminScopeService,
  ) {}

  @Get('overview')
  @ApiZodQuery(AnalyticsOverviewQuery)
  @ApiZodResponse(200, AnalyticsOverview)
  async overview(
    @CurrentUser() me: AuthPrincipal,
    @Query(new ZodPipe(AnalyticsOverviewQuery)) q: Dto.AnalyticsOverviewQuery,
  ): Promise<Dto.AnalyticsOverview> {
    const scope = q.cityId ? await this.scope.assertCity(me, q.cityId) : await this.scope.scope(me);
    return this.counters.overview(q.cityId ?? null, q.days, scope);
  }
}
