import type * as Dto from '@touchgrass/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_SECTIONS,
  AdminCityList,
  GrantRoleBody,
  TeamList,
  UpsertCityBody,
  UpsertNeighbourhoodBody,
} from '@touchgrass/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { AdminScopeService } from '../../common/auth/admin-scope.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { SessionsService } from '../auth/sessions.service.js';
import { CitiesService } from '../cities/cities.service.js';
import { CityWaitlistService } from '../cities/city-waitlist.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { UsersService } from '../users/users.service.js';

/** Admin dashboard: cities and neighbourhoods (F-GRW-03) and the team's roles (F-WEB-03). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminConsoleController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cities: CitiesService,
    private readonly waitlist: CityWaitlistService,
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    private readonly scope: AdminScopeService,
  ) {}

  // ---------- cities ----------

  @Get('cities')
  @Roles(...ADMIN_SECTIONS.cities)
  @ApiZodResponse(200, AdminCityList)
  async listCities(@CurrentUser() me: AuthPrincipal): Promise<Dto.AdminCityList> {
    const scope = await this.scope.scope(me);
    const [rows, counts, roles] = await Promise.all([
      this.cities.adminList(scope),
      this.waitlist.countsByCity(),
      this.users.allRoles(),
    ]);
    const curatorRoles = roles.filter((r) => r.role === 'city_curator' && r.cityId);
    const names = await this.profiles.displayNames(curatorRoles.map((r) => r.userId));
    return {
      items: rows.map((c) => ({
        ...c,
        waitlist: counts.get(c.id) ?? 0,
        curators: curatorRoles
          .filter((r) => r.cityId === c.id)
          .map((r) => ({ userId: r.userId, displayName: names.get(r.userId) ?? null })),
      })),
      // Requests for places that aren't cities yet span every city: admins only.
      requested: scope === 'all' ? await this.waitlist.requested() : [],
    };
  }

  @Post('cities')
  @Roles('admin')
  @Idempotent()
  @ApiZodBody(UpsertCityBody)
  async createCity(
    @CurrentUser() me: AuthPrincipal,
    @Body(new ZodPipe(UpsertCityBody)) body: Dto.UpsertCityBody,
  ): Promise<{ id: string }> {
    return this.saveCity(me, null, body);
  }

  @Put('cities/:id')
  @Roles('admin')
  @ApiZodBody(UpsertCityBody)
  async updateCity(
    @CurrentUser() me: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpsertCityBody)) body: Dto.UpsertCityBody,
  ): Promise<{ id: string }> {
    return this.saveCity(me, id, body);
  }

  private async saveCity(
    me: AuthPrincipal,
    id: string | null,
    body: Dto.UpsertCityBody,
  ): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const saved = await this.cities.upsert(id, body, tx);
      const opened =
        body.launchStatus !== 'waitlist' &&
        (saved.previousStatus === 'waitlist' || saved.previousStatus === null);
      const notified = opened
        ? await this.waitlist.announceLaunch({ id: saved.id, name: body.name }, tx)
        : 0;
      await this.audit.record(
        {
          adminUserId: me.userId,
          action: id ? 'cities.update' : 'cities.create',
          targetType: 'city',
          targetId: saved.id,
          details: {
            slug: body.slug,
            launchStatus: body.launchStatus,
            previousStatus: saved.previousStatus,
            timezone: body.timezone,
            languages: body.languages,
            waitlistNotified: notified,
          },
        },
        tx,
      );
      return { id: saved.id };
    });
  }

  @Post('cities/:id/neighbourhoods')
  @Roles(...ADMIN_SECTIONS.cities)
  @Idempotent()
  @ApiZodBody(UpsertNeighbourhoodBody)
  async addNeighbourhood(
    @CurrentUser() me: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) cityId: string,
    @Body(new ZodPipe(UpsertNeighbourhoodBody)) body: Dto.UpsertNeighbourhoodBody,
  ): Promise<{ id: string }> {
    return this.saveNeighbourhood(me, cityId, null, body);
  }

  @Put('cities/:id/neighbourhoods/:hoodId')
  @Roles(...ADMIN_SECTIONS.cities)
  @ApiZodBody(UpsertNeighbourhoodBody)
  async updateNeighbourhood(
    @CurrentUser() me: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) cityId: string,
    @Param('hoodId', new ParseUUIDPipe()) hoodId: string,
    @Body(new ZodPipe(UpsertNeighbourhoodBody)) body: Dto.UpsertNeighbourhoodBody,
  ): Promise<{ id: string }> {
    return this.saveNeighbourhood(me, cityId, hoodId, body);
  }

  private async saveNeighbourhood(
    me: AuthPrincipal,
    cityId: string,
    hoodId: string | null,
    body: Dto.UpsertNeighbourhoodBody,
  ): Promise<{ id: string }> {
    await this.scope.assertCity(me, cityId);
    return this.db.transaction(async (tx) => {
      const id = await this.cities.upsertNeighbourhood(cityId, hoodId, body, tx);
      await this.audit.record(
        {
          adminUserId: me.userId,
          action: hoodId ? 'neighbourhoods.update' : 'neighbourhoods.create',
          targetType: 'neighbourhood',
          targetId: id,
          details: { cityId, slug: body.slug, name: body.name, radiusKm: body.radiusKm },
        },
        tx,
      );
      return { id };
    });
  }

  // ---------- team ----------

  @Get('team')
  @Roles(...ADMIN_SECTIONS.team)
  @ApiZodResponse(200, TeamList)
  async team(): Promise<Dto.TeamList> {
    const roles = await this.users.allRoles();
    const [names, cityRows] = await Promise.all([
      this.profiles.displayNames([...new Set(roles.map((r) => r.userId))]),
      this.cities.list(),
    ]);
    const cityNames = new Map(cityRows.map((c) => [c.id, c.name]));
    return {
      items: roles.map((r) => ({
        id: r.id,
        userId: r.userId,
        displayName: names.get(r.userId) ?? null,
        role: r.role,
        cityId: r.cityId,
        cityName: r.cityId ? (cityNames.get(r.cityId) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  @Post('team')
  @Roles(...ADMIN_SECTIONS.team)
  @Idempotent()
  @ApiZodBody(GrantRoleBody)
  async grant(
    @CurrentUser() me: AuthPrincipal,
    @Body(new ZodPipe(GrantRoleBody)) body: Dto.GrantRoleBody,
  ): Promise<{ ok: true }> {
    const user = await this.users.findById(body.userId);
    if (!user || user.status === 'deleted') throw AppError.notFound('User');
    if (body.cityId && !(await this.cities.byId(body.cityId))) throw AppError.notFound('City');
    await this.db.transaction(async (tx) => {
      await this.users.grantRole(body.userId, body.role, body.cityId, tx);
      await this.audit.record(
        {
          adminUserId: me.userId,
          action: 'team.grant',
          targetType: 'user',
          targetId: body.userId,
          details: { role: body.role, cityId: body.cityId },
        },
        tx,
      );
    });
    return { ok: true };
  }

  @Delete('team/:roleId')
  @Roles(...ADMIN_SECTIONS.team)
  @HttpCode(204)
  async revoke(
    @CurrentUser() me: AuthPrincipal,
    @Param('roleId', new ParseUUIDPipe()) roleId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const role = await this.users.roleById(roleId, tx);
      if (!role) throw AppError.notFound('Role');
      // Never lock everyone out: the last super admin stays.
      if (role.role === 'super_admin' && (await this.users.countRole('super_admin', tx)) <= 1)
        throw new AppError('CONFLICT', 'Keep at least one super admin', {
          reason: 'LAST_SUPER_ADMIN',
        });
      await this.users.revokeRole(roleId, tx);
      // Signed tokens carry roles: sign the person out so the change applies at once.
      await this.sessions.revokeAll(role.userId, 'role_revoked', tx);
      await this.audit.record(
        {
          adminUserId: me.userId,
          action: 'team.revoke',
          targetType: 'user',
          targetId: role.userId,
          details: { role: role.role, cityId: role.cityId },
        },
        tx,
      );
    });
  }
}
