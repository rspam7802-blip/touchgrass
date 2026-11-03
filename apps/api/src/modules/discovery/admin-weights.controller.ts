import type * as Dto from '@touchgrass/shared';
import { Body, Controller, Delete, Get, Inject, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ADMIN_SECTIONS, RankingWeights, RankingWeightsBody } from '@touchgrass/shared';
import { AuditService } from '../../common/audit/audit.service.js';
import { CurrentUser, Roles } from '../../common/auth/decorators.js';
import type { AuthPrincipal } from '../../common/http/request-context.js';
import { ApiZodBody, ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ZodPipe } from '../../common/validation/zod.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { RankingWeightsService } from './ranking-weights.service.js';

/** Admin dashboard → recommendation weights (F-WEB-03). Feeds pick changes up within a minute. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles(...ADMIN_SECTIONS.weights)
@Controller({ path: 'admin/weights', version: '1' })
export class AdminWeightsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly weights: RankingWeightsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @ApiZodResponse(200, RankingWeights)
  async get(): Promise<Dto.RankingWeights> {
    return this.weights.view();
  }

  @Put()
  @ApiZodBody(RankingWeightsBody)
  @ApiZodResponse(200, RankingWeights)
  async put(
    @CurrentUser() me: AuthPrincipal,
    @Body(new ZodPipe(RankingWeightsBody)) body: Dto.RankingWeightsBody,
  ): Promise<Dto.RankingWeights> {
    const before = await this.weights.current();
    await this.db.transaction(async (tx) => {
      await this.weights.save(body, me.userId, tx);
      await this.audit.record(
        {
          adminUserId: me.userId,
          action: 'weights.update',
          targetType: 'ranking_weights',
          targetId: null,
          details: { before, after: body },
        },
        tx,
      );
    });
    await this.weights.bump();
    return this.weights.view();
  }

  @Delete()
  @ApiZodResponse(200, RankingWeights)
  async reset(@CurrentUser() me: AuthPrincipal): Promise<Dto.RankingWeights> {
    const before = await this.weights.current();
    await this.db.transaction(async (tx) => {
      await this.weights.reset(tx);
      await this.audit.record(
        {
          adminUserId: me.userId,
          action: 'weights.reset',
          targetType: 'ranking_weights',
          targetId: null,
          details: { before },
        },
        tx,
      );
    });
    await this.weights.bump();
    return this.weights.view();
  }
}
