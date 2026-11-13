import { Inject, Injectable } from '@nestjs/common';
import type { CreateReportBody, Severity } from '@touchgrass/shared';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../../common/errors/app-error.js';
import { DB, type Database } from '../../../infra/database/database.module.js';
import { reports } from '../../../infra/database/schema/index.js';
import type { DbOrTx } from '../../../infra/database/types.js';
import { OutboxService } from '../../../infra/outbox/outbox.service.js';
import { MediaService } from '../../media/media.service.js';
import { ModerationService } from '../../moderation/moderation.service.js';
import { SocialGraphService } from '../graph/social-graph.service.js';
import { CATEGORY_SEVERITY, escalate } from './report-severity.js';
import { ReportTargetRegistry } from './report-targets.registry.js';

export const REPORT_CREATED_EVENT = 'report.created';

/** Reports on users, events, messages and Lore (F-SOC-05, F-SAF-05) feed the moderation queue. */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly targets: ReportTargetRegistry,
    private readonly moderation: ModerationService,
    private readonly media: MediaService,
    private readonly graph: SocialGraphService,
    private readonly outbox: OutboxService,
  ) {}

  async create(
    reporterId: string,
    body: CreateReportBody,
  ): Promise<{ id: string; severity: Severity }> {
    const resolver = this.targets.get(body.targetType);
    if (!resolver)
      throw new AppError(
        'VALIDATION_FAILED',
        `Reporting ${body.targetType} content is not available yet`,
      );
    const target = await resolver.resolve(reporterId, body.targetId);
    if (!target) throw AppError.notFound('Report target');
    if (target.ownerUserId === reporterId)
      throw new AppError('VALIDATION_FAILED', 'You cannot report yourself');
    for (const id of body.screenshotMediaIds) {
      const asset = await this.media.ownedOrThrow(reporterId, id);
      if (asset.purpose !== 'report_screenshot')
        throw new AppError(
          'VALIDATION_FAILED',
          'Screenshots must be uploaded as report screenshots',
        );
    }

    const base = CATEGORY_SEVERITY[body.category];
    const result = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(reports)
        .values({
          id: uuidv7(),
          reporterId,
          targetType: body.targetType,
          targetId: body.targetId,
          category: body.category,
          details: body.details,
          screenshotMediaIds: body.screenshotMediaIds,
          severity: base,
          cityId: target.cityId,
        })
        .onConflictDoNothing()
        .returning({ id: reports.id });
      if (!inserted) {
        const [existing] = await tx
          .select({ id: reports.id, severity: reports.severity })
          .from(reports)
          .where(
            and(
              eq(reports.reporterId, reporterId),
              eq(reports.targetType, body.targetType),
              eq(reports.targetId, body.targetId),
            ),
          )
          .orderBy(sql`${reports.createdAt} DESC`)
          .limit(1);
        if (!existing) throw new Error('Report dedupe conflict without an existing report');
        return { id: existing.id, severity: existing.severity, duplicate: true };
      }
      const reporters = await this.distinctReporters(body.targetType, body.targetId, tx);
      const severity = escalate(base, reporters);
      await this.moderation.flagFromReport(
        {
          targetType: body.targetType,
          targetId: body.targetId,
          severity,
          cityId: target.cityId,
          category: body.category,
          reportId: inserted.id,
          reporters,
        },
        tx,
      );
      await this.outbox.add(tx, {
        aggregateType: 'report',
        aggregateId: inserted.id,
        type: REPORT_CREATED_EVENT,
        payload: { severity, targetType: body.targetType, reporterId },
      });
      return { id: inserted.id, severity, duplicate: false };
    });
    if (body.alsoBlock && body.targetType === 'user')
      await this.graph.block(reporterId, body.targetId);
    return { id: result.id, severity: result.severity };
  }

  private async distinctReporters(
    targetType: string,
    targetId: string,
    tx: DbOrTx,
  ): Promise<number> {
    const [row] = await tx
      .select({ n: sql<number>`count(DISTINCT ${reports.reporterId})::int` })
      .from(reports)
      .where(and(eq(reports.targetType, targetType as 'user'), eq(reports.targetId, targetId)));
    return row?.n ?? 0;
  }

  /** How many reports one person has filed (Customer 360, D-192). */
  async countBy(reporterId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(reports)
      .where(eq(reports.reporterId, reporterId));
    return row?.n ?? 0;
  }

  async exportFor(userId: string): Promise<unknown[]> {
    const rows = await this.db.select().from(reports).where(eq(reports.reporterId, userId));
    return rows.map((r) => ({
      targetType: r.targetType,
      category: r.category,
      at: r.createdAt.toISOString(),
    }));
  }

  /** On purge, reports are kept for safety records but no longer linked to the reporter. */
  async detachReporter(userId: string, tx: DbOrTx): Promise<void> {
    await tx.update(reports).set({ reporterId: null }).where(eq(reports.reporterId, userId));
  }
}
