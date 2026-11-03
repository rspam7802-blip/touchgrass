import type * as Dto from '@touchgrass/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_SECTIONS,
  AdminCancelEventBody,
  AdminEventDetail,
  AdminEventPage,
  AdminEventQuery,
  CreateEventBody,
  FeatureEventBody,
  UpdateEventBody,
} from '@touchgrass/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { AdminScopeService } from '../../common/auth/admin-scope.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { AdminEventsService } from './admin-events.service.js';
import { EventsService } from './events.service.js';

/** Admin dashboard → events: curate, feature, edit, cancel (F-WEB-03, F-GRW-03). City curators: their cities only. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(...ADMIN_SECTIONS.events)
@Controller({ path: 'admin/events', version: '1' })
export class AdminEventsController {
  constructor(
    private readonly admin: AdminEventsService,
    private readonly events: EventsService,
    private readonly scope: AdminScopeService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiZodQuery(AdminEventQuery)
  @ApiZodResponse(200, AdminEventPage)
  async list(
    @CurrentUser() me: AuthPrincipal,
    @Query(new ZodPipe(AdminEventQuery)) q: Dto.AdminEventQuery,
  ): Promise<Dto.AdminEventPage> {
    return this.admin.list(q, await this.scope.scope(me));
  }

  @Get(':id')
  @ApiZodResponse(200, AdminEventDetail)
  async detail(
    @CurrentUser() me: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Dto.AdminEventDetail> {
    return this.admin.detail(id, await this.scope.scope(me));
  }

  /** A curated plan, hosted by the person creating it on TouchGrass's behalf. */
  @Post()
  @Idempotent()
  @ApiZodBody(CreateEventBody)
  async create(
    @CurrentUser() me: AuthPrincipal,
    @Body(new ZodPipe(CreateEventBody)) body: Dto.CreateEventBody,
  ): Promise<{ id: string; slug: string }> {
    const created = await this.events.create(me.userId, me.roles, { ...body, type: 'curated' });
    await this.audit.record({
      adminUserId: me.userId,
      action: 'events.create_curated',
      targetType: 'event',
      targetId: created.id,
      details: { title: created.title, startsAt: created.startsAt, publish: body.publish },
    });
    return { id: created.id, slug: created.slug };
  }

  @Patch(':id')
  @ApiZodBody(UpdateEventBody)
  async update(
    @CurrentUser() me: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateEventBody)) body: Dto.UpdateEventBody,
  ): Promise<Dto.AdminEventDetail> {
    const scope = await this.scope.scope(me);
    await this.events.staffUpdate(me.userId, id, body, scope);
    await this.audit.record({
      adminUserId: me.userId,
      action: 'events.update',
      targetType: 'event',
      targetId: id,
      details: { fields: Object.keys(body) },
    });
    return this.admin.detail(id, scope);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Idempotent()
  @ApiZodBody(AdminCancelEventBody)
  async cancel(
    @CurrentUser() me: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AdminCancelEventBody)) body: Dto.AdminCancelEventBody,
  ): Promise<Dto.AdminEventDetail> {
    const scope = await this.scope.scope(me);
    await this.events.staffCancel(me.userId, id, body.reason, scope);
    await this.audit.record({
      adminUserId: me.userId,
      action: 'events.cancel',
      targetType: 'event',
      targetId: id,
      details: { reason: body.reason },
    });
    return this.admin.detail(id, scope);
  }

  @Put(':id/feature')
  @ApiZodBody(FeatureEventBody)
  async feature(
    @CurrentUser() me: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(FeatureEventBody)) body: Dto.FeatureEventBody,
  ): Promise<Dto.AdminEventDetail> {
    const scope = await this.scope.scope(me);
    await this.admin.feature(me.userId, id, body, scope);
    return this.admin.detail(id, scope);
  }

  @Delete(':id/feature')
  @HttpCode(204)
  async unfeature(
    @CurrentUser() me: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.admin.unfeature(me.userId, id, await this.scope.scope(me));
  }
}
