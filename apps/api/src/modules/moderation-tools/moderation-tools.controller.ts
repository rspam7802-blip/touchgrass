import type * as Dto from '@touchgrass/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AdminUserDetail,
  AdminUserList,
  AdminUserQuery,
  ModerationItemDetail,
  ResolveModerationBody,
  SanctionBody,
} from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { AdminUsersService } from './admin-users.service.js';
import { ModerationToolsService } from './moderation-tools.service.js';
import { SanctionsService } from './sanctions.service.js';

const SetVerifiedBody = z.object({ verified: z.boolean() });

/** Moderator tooling (F-SAF-05, F-SAF-06, F-WEB-03): review items, act on people, manage badges. All audited. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class ModerationToolsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly tools: ModerationToolsService,
    private readonly users: AdminUsersService,
    private readonly sanctions: SanctionsService,
  ) {}

  @Get('moderation/items/:id')
  @Roles('moderator', 'admin')
  @ApiZodResponse(200, ModerationItemDetail)
  item(@Param('id', new ParseUUIDPipe()) id: string): Promise<ModerationItemDetail> {
    return this.tools.detail(id);
  }

  @Post('moderation/items/:id/resolve')
  @HttpCode(200)
  @Roles('moderator', 'admin')
  @Idempotent()
  @ApiZodBody(ResolveModerationBody)
  @ApiZodResponse(200, ModerationItemDetail)
  resolve(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(ResolveModerationBody)) body: Dto.ResolveModerationBody,
  ): Promise<ModerationItemDetail> {
    return this.tools.resolve(admin.userId, id, body);
  }

  @Get('users')
  @Roles('moderator', 'admin', 'support')
  @ApiZodQuery(AdminUserQuery)
  @ApiZodResponse(200, AdminUserList)
  async searchUsers(
    @Query(new ZodPipe(AdminUserQuery)) q: Dto.AdminUserQuery,
  ): Promise<AdminUserList> {
    return { items: await this.users.search(q.q) };
  }

  @Get('users/:id')
  @Roles('moderator', 'admin', 'support')
  @ApiZodResponse(200, AdminUserDetail)
  user(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminUserDetail> {
    return this.users.detail(admin.userId, id);
  }

  @Post('users/:id/sanctions')
  @HttpCode(200)
  @Roles('moderator', 'admin')
  @Idempotent()
  @ApiZodBody(SanctionBody)
  @ApiZodResponse(200, AdminUserDetail)
  async sanction(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(SanctionBody)) body: Dto.SanctionBody,
  ): Promise<AdminUserDetail> {
    const after = await this.db.transaction((tx) =>
      this.sanctions.apply(admin.userId, id, body, tx),
    );
    if (after) await after();
    return this.users.detail(admin.userId, id);
  }

  @Post('sanctions/:id/lift')
  @HttpCode(200)
  @Roles('moderator', 'admin')
  @ApiZodResponse(200, AdminUserDetail)
  async lift(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdminUserDetail> {
    const userId = await this.sanctions.lift(admin.userId, id);
    return this.users.detail(admin.userId, userId);
  }

  @Post('users/:id/verification')
  @HttpCode(200)
  @Roles('moderator', 'admin')
  @ApiZodBody(SetVerifiedBody)
  @ApiZodResponse(200, AdminUserDetail)
  setVerified(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(SetVerifiedBody)) body: z.infer<typeof SetVerifiedBody>,
  ): Promise<AdminUserDetail> {
    return this.users.setVerified(admin.userId, id, body.verified);
  }
}
