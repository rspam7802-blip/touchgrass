import {
  Body,
  Controller,
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
  AdminVenueList,
  AdminVenueQuery,
  PerkPass,
  PerkPassPreview,
  RedeemPerkBody,
  UpdateVenuePartnerBody,
  UpsertPerkBody,
  VenuePerk,
} from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser, Public, Roles } from '../../common/auth/decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { RateLimit } from '../../common/rate-limit/rate-limit.decorator.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { AdminScopeService } from '../../common/auth/admin-scope.js';
import { VenuesService } from '../venues/venues.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { PerksService } from './perks.service.js';

const PassToken = z.string().regex(/^[A-Za-z0-9_-]{40,64}$/);

/** Getting a perk pass for a plan (F-PAY-04). */
@ApiTags('perks')
@ApiBearerAuth()
@Controller({ path: 'events', version: '1' })
export class EventPerksController {
  constructor(private readonly perks: PerksService) {}

  @Post(':id/perks/:perkId/pass')
  @RateLimit({ name: 'perk-pass', limit: 30, windowSeconds: 3600, by: 'user' })
  @ApiZodResponse(201, PerkPass)
  pass(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('perkId', new ParseUUIDPipe()) perkId: string,
  ): Promise<Dto.PerkPass> {
    return this.perks.pass(user.userId, id, perkId);
  }
}

/** Venue staff side (web page opened by the QR code). No login: the venue PIN authorises the redemption. */
@ApiTags('perks')
@Controller({ path: 'perk-passes', version: '1' })
export class PerkPassesController {
  constructor(private readonly perks: PerksService) {}

  @Get(':token')
  @Public()
  @RateLimit({ name: 'perk-preview', limit: 120, windowSeconds: 3600, by: 'ip' })
  @ApiZodResponse(200, PerkPassPreview)
  preview(@Param('token', new ZodPipe(PassToken)) token: string): Promise<Dto.PerkPassPreview> {
    return this.perks.preview(token);
  }

  @Post('redeem')
  @Public()
  @HttpCode(200)
  @RateLimit({ name: 'perk-redeem', limit: 20, windowSeconds: 3600, by: 'ip' })
  @ApiZodBody(RedeemPerkBody)
  @ApiZodResponse(200, PerkPassPreview)
  redeem(
    @Body(new ZodPipe(RedeemPerkBody)) body: Dto.RedeemPerkBody,
  ): Promise<Dto.PerkPassPreview> {
    return this.perks.redeem(body);
  }
}

/** Venues and perks in the admin dashboard. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin/venues', version: '1' })
export class VenuesAdminController {
  constructor(
    private readonly perks: PerksService,
    private readonly venues: VenuesService,
    private readonly audit: AuditService,
    private readonly scope: AdminScopeService,
  ) {}

  /** Curators manage only venues in their cities (D-118). */
  private async assertVenue(user: AuthPrincipal, venueId: string | null): Promise<void> {
    if (!venueId) throw AppError.notFound('Venue');
    const cityId = await this.venues.cityOf(venueId);
    if (!cityId) throw AppError.notFound('Venue');
    await this.scope.assertCity(user, cityId);
  }

  @Get()
  @Roles('admin', 'city_curator')
  @ApiZodQuery(AdminVenueQuery)
  @ApiZodResponse(200, AdminVenueList)
  async list(
    @CurrentUser() user: AuthPrincipal,
    @Query(new ZodPipe(AdminVenueQuery)) q: Dto.AdminVenueQuery,
  ): Promise<{ items: Dto.AdminVenue[]; nextCursor: string | null }> {
    return this.perks.adminVenues(q, await this.scope.scope(user));
  }

  @Put(':id/partner')
  @Roles('admin', 'city_curator')
  @HttpCode(204)
  @ApiZodBody(UpdateVenuePartnerBody)
  async partner(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpdateVenuePartnerBody)) body: Dto.UpdateVenuePartnerBody,
  ): Promise<void> {
    await this.assertVenue(user, id);
    await this.perks.setPartner(id, body);
    await this.audit.record({
      adminUserId: user.userId,
      action: 'venue.partner',
      targetType: 'venue',
      targetId: id,
      details: { isPartner: body.isPartner, pinChanged: body.staffPin !== undefined },
    });
  }

  @Post(':id/perks')
  @Roles('admin', 'city_curator')
  @ApiZodBody(UpsertPerkBody)
  @ApiZodResponse(201, VenuePerk)
  async createPerk(
    @CurrentUser() user: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpsertPerkBody)) body: Dto.UpsertPerkBody,
  ): Promise<Dto.VenuePerk> {
    await this.assertVenue(user, id);
    const perk = await this.perks.createPerk(id, body);
    await this.audit.record({
      adminUserId: user.userId,
      action: 'perk.create',
      targetType: 'perk',
      targetId: perk.id,
      details: { venueId: id, title: perk.title },
    });
    return perk;
  }

  @Put('perks/:perkId')
  @Roles('admin', 'city_curator')
  @ApiZodBody(UpsertPerkBody)
  @ApiZodResponse(200, VenuePerk)
  async updatePerk(
    @CurrentUser() user: AuthPrincipal,
    @Param('perkId', new ParseUUIDPipe()) perkId: string,
    @Body(new ZodPipe(UpsertPerkBody)) body: Dto.UpsertPerkBody,
  ): Promise<Dto.VenuePerk> {
    await this.assertVenue(user, await this.perks.perkVenueId(perkId));
    const perk = await this.perks.updatePerk(perkId, body);
    await this.audit.record({
      adminUserId: user.userId,
      action: 'perk.update',
      targetType: 'perk',
      targetId: perkId,
      details: { active: perk.active },
    });
    return perk;
  }
}
