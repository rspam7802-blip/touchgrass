import type * as Dto from '@touchgrass/shared';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_SECTIONS,
  AdminNotificationTemplateList,
  NOTIFICATION_KINDS,
  NOTIFICATION_TEMPLATES,
  type NotificationKind,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
  TemplateOverrideBody,
  translate,
} from '@touchgrass/shared';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import {
  allowedPlaceholders,
  overrideKey,
  TemplateOverridesService,
} from './template-overrides.service.js';

const Kind = z.enum(NOTIFICATION_KINDS as [NotificationKind, ...NotificationKind[]]);
const Lang = z.enum(SUPPORTED_LANGUAGES);

/** Admin dashboard → notification templates (F-WEB-03): see every kind and reword it per language. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(...ADMIN_SECTIONS.notificationTemplates)
@Controller({ path: 'admin/notification-templates', version: '1' })
export class AdminTemplatesController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly overrides: TemplateOverridesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiZodResponse(200, AdminNotificationTemplateList)
  async list(): Promise<Dto.AdminNotificationTemplateList> {
    const ov = await this.overrides.all();
    const copy = (kind: NotificationKind, lang: SupportedLanguage) => {
      const t = NOTIFICATION_TEMPLATES[kind];
      return { title: translate(t.title, lang), body: translate(t.body, lang) };
    };
    return {
      items: NOTIFICATION_KINDS.map((kind) => {
        const t = NOTIFICATION_TEMPLATES[kind];
        const flags = t as { inbox?: boolean; batch?: boolean; urgent?: boolean };
        return {
          kind,
          category: t.category,
          link: t.link,
          inbox: flags.inbox ?? true,
          batch: flags.batch ?? false,
          urgent: flags.urgent ?? false,
          placeholders: allowedPlaceholders(kind, 'en'),
          defaults: { en: copy(kind, 'en'), te: copy(kind, 'te'), hi: copy(kind, 'hi') },
          overrides: {
            en: ov.get(overrideKey(kind, 'en')) ?? null,
            te: ov.get(overrideKey(kind, 'te')) ?? null,
            hi: ov.get(overrideKey(kind, 'hi')) ?? null,
          },
        };
      }),
    };
  }

  @Put(':kind/:lang')
  @ApiZodBody(TemplateOverrideBody)
  async set(
    @CurrentUser() me: AuthPrincipal,
    @Param('kind', new ZodPipe(Kind)) kind: NotificationKind,
    @Param('lang', new ZodPipe(Lang)) lang: SupportedLanguage,
    @Body(new ZodPipe(TemplateOverrideBody)) body: Dto.TemplateOverrideBody,
  ): Promise<{ ok: true }> {
    await this.db.transaction(async (tx) => {
      await this.overrides.set(kind, lang, body, me.userId, tx);
      await this.audit.record(
        {
          adminUserId: me.userId,
          action: 'notification_templates.set',
          targetType: 'notification_template',
          targetId: overrideKey(kind, lang),
          details: { title: body.title, body: body.body },
        },
        tx,
      );
    });
    await this.overrides.bump();
    return { ok: true };
  }

  @Delete(':kind/:lang')
  @HttpCode(204)
  async clear(
    @CurrentUser() me: AuthPrincipal,
    @Param('kind', new ZodPipe(Kind)) kind: NotificationKind,
    @Param('lang', new ZodPipe(Lang)) lang: SupportedLanguage,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.overrides.clear(kind, lang, tx);
      await this.audit.record(
        {
          adminUserId: me.userId,
          action: 'notification_templates.reset',
          targetType: 'notification_template',
          targetId: overrideKey(kind, lang),
        },
        tx,
      );
    });
    await this.overrides.bump();
  }
}
