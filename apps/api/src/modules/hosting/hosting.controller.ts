import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type * as Dto from '@touchgrass/shared';
import {
  AdminHostApplicationList,
  AdminHostApplicationQuery,
  CreateHostApplicationBody,
  EventAnalytics,
  HostAnalytics,
  HostApplication,
  HostStatus,
  ReviewHostApplicationBody,
} from '@touchgrass/shared';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { AppError } from '../../common/errors/app-error.js';
import { AdminScopeService } from '../../common/auth/admin-scope.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { HostAnalyticsService } from './host-analytics.service.js';
import { HostingService } from './hosting.service.js';

/** Hosting status, applications to sell tickets (F-HST-01) and insights (F-HST-02). */
@ApiTags('hosting')
@ApiBearerAuth()
@Controller({ path: 'host', version: '1' })
export class HostingController {
  constructor(
    private readonly hosting: HostingService,
    private readonly analytics: HostAnalyticsService,
  ) {}

  @Get('status')
  @ApiZodResponse(200, HostStatus)
  status(@CurrentUser() user: AuthPrincipal): Promise<Dto.HostStatus> {
    return this.hosting.status(user.userId);
  }

  @Post('applications')
  @Idempotent()
  @RateLimit({ name: 'host-application', limit: 3, windowSeconds: 86_400, by: 'user' })
  @ApiZodBody(CreateHostApplicationBody)
  @ApiZodResponse(201, HostApplication)
  apply(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodPipe(CreateHostApplicationBody)) body: Dto.CreateHostApplicationBody,
  ): Promise<Dto.HostApplication> {
    return this.hosting.apply(user.userId, body);
  }

  @Get('analytics')
  @ApiZodResponse(200, HostAnalytics)
  overall(@CurrentUser() user: AuthPrincipal): Promise<Dto.HostAnalytics> {
    return this.analytics.overall(user.userId);
  }

  @Get('analytics/events/:id')
  @ApiZodResponse(200, EventAnalytics)
  event(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.EventAnalytics> {
    return this.analytics.event(user.userId, id);
  }
}

/** Host application queue for the admin dashboard. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin/host-applications', version: '1' })
export class HostApplicationsAdminController {
  constructor(
    private readonly hosting: HostingService,
    private readonly audit: AuditService,
    private readonly scope: AdminScopeService,
  ) {}

  @Get()
  @Roles('admin', 'city_curator')
  @ApiZodQuery(AdminHostApplicationQuery)
  @ApiZodResponse(200, AdminHostApplicationList)
  async list(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(AdminHostApplicationQuery)) q: Dto.AdminHostApplicationQuery,
  ): Promise<{ items: Dto.AdminHostApplication[]; nextCursor: string | null }> {
    return this.hosting.adminList(user.userId, q, await this.scope.scope(user));
  }

  @Post(':id/review')
  @Roles('admin', 'city_curator')
  @ApiZodBody(ReviewHostApplicationBody)
  @ApiZodResponse(201, HostApplication)
  async review(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ReviewHostApplicationBody)) body: Dto.ReviewHostApplicationBody,
  ): Promise<Dto.HostApplication> {
    const cityId = await this.hosting.applicantCity(id);
    if (cityId === undefined) throw AppError.notFound('Host application');
    await this.scope.assertCity(user, cityId);
    const result = await this.hosting.review(user.userId, id, body);
    await this.audit.record({
      adminUserId: user.userId,
      action: `host_application.${body.decision === 'approved' ? 'approve' : 'reject'}`,
      targetType: 'host_application',
      targetId: id,
      details: { note: body.note },
    });
    return result;
  }
}
