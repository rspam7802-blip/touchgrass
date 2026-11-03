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
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  AppSettingKey,
  AppSettings,
  AuditEntry,
  BulkInviteBody,
  FEATURE_FLAG_DEFAULTS,
  FeatureFlagList,
  InviteCode,
  ModerationQueueItem,
  isFeatureFlagKey,
  type Paginated,
  PaginationQuery,
  paginated,
  UpdateAppSettingBody,
  UpdateFeatureFlagBody,
} from '@touchgrass/shared';
import { z } from 'zod';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import { AppError } from '../../common/errors/app-error.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodQuery, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { InvitesService } from '../invites/invites.service.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { AppSettingsService } from '../platform/app-settings.service.js';
import { FeatureFlagsService } from '../platform/feature-flags.service.js';
import { AuditService } from '../../common/audit/audit.service.js';

const InviteCodePage = paginated(InviteCode);
const AuditPage = paginated(AuditEntry);
const ModerationPage = paginated(ModerationQueueItem);
const BulkResult = z.object({ items: z.array(InviteCode) });

/** Admin API (F-WEB-03). Every mutation writes an audit entry in the same transaction. */
@ApiTags('admin')
@ApiBearerAuth()
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly invites: InvitesService,
    private readonly flags: FeatureFlagsService,
    private readonly settings: AppSettingsService,
    private readonly audit: AuditService,
    private readonly moderation: ModerationService,
  ) {}

  @Get('invite-codes')
  @Roles('admin', 'support')
  @ApiZodQuery(PaginationQuery)
  @ApiZodResponse(200, InviteCodePage)
  listInvites(
    @Query(new ZodPipe(PaginationQuery)) q: Dto.PaginationQuery,
  ): Promise<Paginated<InviteCode>> {
    return this.invites.list(q.cursor, q.limit);
  }

  @Post('invite-codes/bulk')
  @Roles('admin')
  @Idempotent()
  @ApiZodBody(BulkInviteBody)
  @ApiZodResponse(201, BulkResult)
  async bulkInvites(
    @CurrentUser() admin: AuthPrincipal,
    @Body(new ZodPipe(BulkInviteBody)) body: Dto.BulkInviteBody,
  ): Promise<z.infer<typeof BulkResult>> {
    return this.db.transaction(async (tx) => {
      const items = await this.invites.createBulk(admin.userId, body, tx);
      await this.audit.record(
        {
          adminUserId: admin.userId,
          action: 'invite_codes.bulk_create',
          targetType: 'invite_code_batch',
          targetId: null,
          details: { count: body.count, maxUses: body.maxUses, label: body.label },
        },
        tx,
      );
      return { items };
    });
  }

  @Post('invite-codes/:id/revoke')
  @HttpCode(200)
  @Roles('admin')
  @ApiZodResponse(200, InviteCode)
  async revokeInvite(
    @CurrentUser() admin: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<InviteCode> {
    return this.db.transaction(async (tx) => {
      const invite = await this.invites.revoke(id, tx);
      await this.audit.record(
        {
          adminUserId: admin.userId,
          action: 'invite_codes.revoke',
          targetType: 'invite_code',
          targetId: id,
          details: { code: invite.code },
        },
        tx,
      );
      return invite;
    });
  }

  @Get('feature-flags')
  @Roles('admin')
  @ApiZodResponse(200, FeatureFlagList)
  async listFlags(): Promise<z.infer<typeof FeatureFlagList>> {
    const flags = await this.flags.all();
    return {
      items: Object.keys(FEATURE_FLAG_DEFAULTS).map((key) => ({
        key,
        enabled: flags[key] ?? false,
        description: '',
      })),
    };
  }

  @Put('feature-flags/:key')
  @Roles('super_admin')
  @ApiZodBody(UpdateFeatureFlagBody)
  async setFlag(
    @CurrentUser() admin: AuthPrincipal,
    @Param('key') key: string,
    @Body(new ZodPipe(UpdateFeatureFlagBody)) body: Dto.UpdateFeatureFlagBody,
  ): Promise<{ key: string; enabled: boolean }> {
    if (!isFeatureFlagKey(key)) throw AppError.notFound('Feature flag');
    await this.db.transaction(async (tx) => {
      await this.audit.record(
        {
          adminUserId: admin.userId,
          action: 'feature_flags.set',
          targetType: 'feature_flag',
          targetId: key,
          details: { enabled: body.enabled },
        },
        tx,
      );
    });
    await this.flags.set(key, body.enabled, body.description);
    return { key, enabled: body.enabled };
  }

  @Get('settings')
  @Roles('admin')
  @ApiZodResponse(200, AppSettings)
  async listSettings(): Promise<z.infer<typeof AppSettings>> {
    const all = await this.settings.all();
    return { items: AppSettingKey.options.map((key) => ({ key, value: all[key] })) };
  }

  @Put('settings/:key')
  @Roles('admin')
  @ApiZodBody(UpdateAppSettingBody)
  async setSetting(
    @CurrentUser() admin: AuthPrincipal,
    @Param('key', new ZodPipe(AppSettingKey)) key: Dto.AppSettingKey,
    @Body(new ZodPipe(UpdateAppSettingBody)) body: Dto.UpdateAppSettingBody,
  ): Promise<{ key: AppSettingKey; value: number }> {
    await this.db.transaction(async (tx) => {
      await this.settings.set(key, body.value, tx);
      await this.audit.record(
        {
          adminUserId: admin.userId,
          action: 'settings.set',
          targetType: 'app_setting',
          targetId: key,
          details: { value: body.value },
        },
        tx,
      );
    });
    return { key, value: body.value };
  }

  @Get('audit-log')
  @Roles('admin')
  @ApiZodQuery(PaginationQuery)
  @ApiZodResponse(200, AuditPage)
  auditLog(
    @Query(new ZodPipe(PaginationQuery)) q: Dto.PaginationQuery,
  ): Promise<Paginated<AuditEntry>> {
    return this.audit.list(q.cursor, q.limit);
  }

  /** Open reports and flagged content, most severe first (actions live in the moderation tools module). */
  @Get('moderation/queue')
  @Roles('moderator', 'admin')
  @ApiZodQuery(PaginationQuery)
  @ApiZodResponse(200, ModerationPage)
  moderationQueue(
    @Query(new ZodPipe(PaginationQuery)) q: Dto.PaginationQuery,
  ): Promise<Paginated<ModerationQueueItem>> {
    return this.moderation.queue(q.cursor, q.limit);
  }
}
