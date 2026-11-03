import type * as Dto from '@touchgrass/shared';
import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ADMIN_SECTIONS,
  AdminTaxonomy,
  UpsertInterestBody,
  UpsertVibeTagBody,
} from '@touchgrass/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { Idempotent } from '../../common/idempotency/idempotency.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { EventSearchService } from '../events/event-search.service.js';
import { InterestsService } from '../interests/interests.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';

/**
 * Admin dashboard → vibe tags and interests (F-EVT-11, F-WEB-03). Items are retired by hiding them
 * (`active: false`), never deleted, so plans and profiles that use them keep their labels.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(...ADMIN_SECTIONS.taxonomy)
@Controller({ path: 'admin/taxonomy', version: '1' })
export class AdminTaxonomyController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly taxonomy: InterestsService,
    private readonly profiles: ProfilesService,
    private readonly search: EventSearchService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiZodResponse(200, AdminTaxonomy)
  async list(): Promise<Dto.AdminTaxonomy> {
    const [all, people, plans] = await Promise.all([
      this.taxonomy.adminAll(),
      this.profiles.taxonomyUsage(),
      this.search.taxonomyUsage(),
    ]);
    const usage = (id: string): number => (people.get(id) ?? 0) + (plans.get(id) ?? 0);
    return {
      interests: all.interests.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        emoji: r.emoji,
        category: r.category,
        sortOrder: r.sortOrder,
        active: r.active,
        usage: usage(r.id),
      })),
      vibeTags: all.vibeTags.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        emoji: r.emoji,
        category: null,
        sortOrder: r.sortOrder,
        active: r.active,
        usage: usage(r.id),
      })),
    };
  }

  @Post('interests')
  @Idempotent()
  @ApiZodBody(UpsertInterestBody)
  async addInterest(
    @CurrentUser() me: AuthPrincipal,
    @Body(new ZodPipe(UpsertInterestBody)) body: Dto.UpsertInterestBody,
  ): Promise<{ id: string }> {
    return this.saveInterest(me, null, body);
  }

  @Put('interests/:id')
  @ApiZodBody(UpsertInterestBody)
  async editInterest(
    @CurrentUser() me: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpsertInterestBody)) body: Dto.UpsertInterestBody,
  ): Promise<{ id: string }> {
    return this.saveInterest(me, id, body);
  }

  @Post('vibe-tags')
  @Idempotent()
  @ApiZodBody(UpsertVibeTagBody)
  async addVibe(
    @CurrentUser() me: AuthPrincipal,
    @Body(new ZodPipe(UpsertVibeTagBody)) body: Dto.UpsertVibeTagBody,
  ): Promise<{ id: string }> {
    return this.saveVibe(me, null, body);
  }

  @Put('vibe-tags/:id')
  @ApiZodBody(UpsertVibeTagBody)
  async editVibe(
    @CurrentUser() me: AuthPrincipal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(UpsertVibeTagBody)) body: Dto.UpsertVibeTagBody,
  ): Promise<{ id: string }> {
    return this.saveVibe(me, id, body);
  }

  private async saveInterest(
    me: AuthPrincipal,
    id: string | null,
    body: Dto.UpsertInterestBody,
  ): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const saved = await this.taxonomy.upsertInterest(id, body, tx);
      await this.audit.record(
        {
          adminUserId: me.userId,
          action: id ? 'interests.update' : 'interests.create',
          targetType: 'interest',
          targetId: saved,
          details: { slug: body.slug, name: body.name, active: body.active },
        },
        tx,
      );
      return { id: saved };
    });
  }

  private async saveVibe(
    me: AuthPrincipal,
    id: string | null,
    body: Dto.UpsertVibeTagBody,
  ): Promise<{ id: string }> {
    return this.db.transaction(async (tx) => {
      const saved = await this.taxonomy.upsertVibeTag(id, body, tx);
      await this.audit.record(
        {
          adminUserId: me.userId,
          action: id ? 'vibe_tags.update' : 'vibe_tags.create',
          targetType: 'vibe_tag',
          targetId: saved,
          details: { slug: body.slug, name: body.name, active: body.active },
        },
        tx,
      );
      return { id: saved };
    });
  }
}
