import { Inject, Injectable } from '@nestjs/common';
import type {
  ModerationItemDetail,
  ModerationPreview,
  ResolveModerationBody,
} from '@touchgrass/shared';
import { and, eq } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { moderationItems } from '../../infra/database/schema/index.js';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  type AfterCommit,
  GONE,
  ModerationTargetRegistry,
} from '../moderation/moderation-targets.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SanctionsService } from './sanctions.service.js';

type ItemRow = typeof moderationItems.$inferSelect;

/**
 * Reviewing the moderation queue (F-SAF-05, F-SAF-06): see what was flagged or reported, release it or take it
 * down through the owning module, and optionally sanction its owner, all in one audited transaction.
 */
@Injectable()
export class ModerationToolsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly targets: ModerationTargetRegistry,
    private readonly sanctions: SanctionsService,
    private readonly audit: AuditService,
    private readonly profiles: ProfilesService,
  ) {}

  private async preview(item: ItemRow): Promise<ModerationPreview> {
    const handler = this.targets.get(item.targetType);
    const preview = handler ? await handler.preview(item.targetId) : GONE;
    if (!preview.owner) return preview;
    // Handlers that can't read names (media) leave them blank; fill them in one place.
    const names = await this.profiles.displayNames([preview.owner.id]);
    return {
      ...preview,
      owner: {
        id: preview.owner.id,
        displayName: preview.owner.displayName || (names.get(preview.owner.id) ?? ''),
      },
    };
  }

  private async toDetail(item: ItemRow): Promise<ModerationItemDetail> {
    return {
      id: item.id,
      targetType: item.targetType,
      targetId: item.targetId,
      source: item.source,
      severity: item.severity,
      status: item.status,
      details: item.details,
      reportCount: typeof item.details.reportCount === 'number' ? item.details.reportCount : 0,
      createdAt: item.createdAt.toISOString(),
      preview: await this.preview(item),
    };
  }

  async detail(itemId: string): Promise<ModerationItemDetail> {
    const [item] = await this.db
      .select()
      .from(moderationItems)
      .where(eq(moderationItems.id, itemId));
    if (!item) throw AppError.notFound('Moderation item');
    return this.toDetail(item);
  }

  async resolve(
    adminId: string,
    itemId: string,
    body: ResolveModerationBody,
    now: Date = new Date(),
  ): Promise<ModerationItemDetail> {
    const [found] = await this.db
      .select()
      .from(moderationItems)
      .where(eq(moderationItems.id, itemId));
    if (!found) throw AppError.notFound('Moderation item');
    const handler = this.targets.get(found.targetType);
    // Read before the take-down so the owner is still known afterwards.
    const preview = await this.preview(found);
    if (body.sanction && !preview.owner)
      throw new AppError('VALIDATION_FAILED', 'Nobody to act on', [
        { path: 'sanction', message: 'This content has no owner any more', code: 'custom' },
      ]);
    const afters: AfterCommit[] = [];
    await this.db.transaction(async (tx) => {
      const [item] = await tx
        .select()
        .from(moderationItems)
        .where(eq(moderationItems.id, itemId))
        .for('update');
      if (!item || item.status !== 'open')
        throw new AppError('CONFLICT', 'Already handled', { reason: 'ALREADY_RESOLVED' });
      if (handler && !preview.gone)
        afters.push(
          body.outcome === 'remove'
            ? await handler.remove(item.targetId, tx)
            : await handler.release(item.targetId, tx),
        );
      const resolution = {
        outcome: body.outcome,
        note: body.note,
        by: adminId,
        at: now.toISOString(),
      };
      await tx
        .update(moderationItems)
        .set({
          status: body.outcome === 'remove' ? 'actioned' : 'dismissed',
          resolvedByUserId: adminId,
          resolvedAt: now,
          details: { ...item.details, resolution },
        })
        .where(eq(moderationItems.id, itemId));
      // Taking something down settles every other open item about it (e.g. a report and a text flag).
      if (body.outcome === 'remove')
        await tx
          .update(moderationItems)
          .set({ status: 'actioned', resolvedByUserId: adminId, resolvedAt: now })
          .where(
            and(
              eq(moderationItems.targetType, item.targetType),
              eq(moderationItems.targetId, item.targetId),
              eq(moderationItems.status, 'open'),
            ),
          );
      if (body.sanction && preview.owner)
        afters.push(
          await this.sanctions.apply(adminId, preview.owner.id, body.sanction, tx, {
            moderationItemId: itemId,
            now,
          }),
        );
      await this.audit.record(
        {
          adminUserId: adminId,
          action: `moderation.${body.outcome}`,
          targetType: item.targetType,
          targetId: item.targetId,
          details: { itemId, source: item.source, note: body.note },
        },
        tx,
      );
    });
    for (const after of afters) if (after) await after();
    if (body.outcome === 'remove' && preview.owner && !preview.gone)
      await this.sanctions.notifyRemoved(preview.owner.id);
    return this.detail(itemId);
  }
}
