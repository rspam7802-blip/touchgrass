import { Inject, Injectable } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  type ModerationQueueItem,
  type Paginated,
  type Severity,
  screenTexts,
  type TextScreenResult,
} from '@touchgrass/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { DB, type Database } from '../../infra/database/database.module.js';
import { moderationItems } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import type { ModerationTargetType } from './moderation-targets.js';

export interface FlagInput {
  targetType: ModerationTargetType;
  targetId: string;
  source: 'auto_image' | 'auto_text' | 'report';
  severity: Severity;
  details?: Record<string, unknown>;
  cityId?: string | null;
}

/** Moderation queue intake (F-SAF-06): automatic image/text flags and reports. Review lives in moderation tools. */
@Injectable()
export class ModerationService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Idempotent per open (target, source): repeated flags of the same thing do not duplicate queue items. */
  async flag(input: FlagInput, db: DbOrTx = this.db): Promise<void> {
    await db
      .insert(moderationItems)
      .values({
        id: uuidv7(),
        ...input,
        details: input.details ?? {},
        cityId: input.cityId ?? null,
      })
      .onConflictDoNothing();
  }

  /** Screens user text in English, Telugu and Hindi. Flagged text is still saved, but held for review. */
  screen(...texts: (string | null | undefined)[]): TextScreenResult {
    return screenTexts(...texts);
  }

  /** Opens an `auto_text` item for content that `screen` flagged; call in the same transaction as the write. */
  async flagText(
    target: { type: ModerationTargetType; id: string; cityId?: string | null },
    result: TextScreenResult,
    db: DbOrTx = this.db,
  ): Promise<void> {
    if (!result.flagged || !result.severity) return;
    await this.flag(
      {
        targetType: target.type,
        targetId: target.id,
        source: 'auto_text',
        severity: result.severity,
        details: { matches: result.matches },
        cityId: target.cityId ?? null,
      },
      db,
    );
  }

  /**
   * Report intake: one open queue item per target. Further reports raise its severity (never lower it)
   * and keep a running count of distinct reporters.
   */
  async flagFromReport(
    input: {
      targetType: string;
      targetId: string;
      severity: Severity;
      cityId: string | null;
      category: string;
      reportId: string;
      reporters: number;
    },
    db: DbOrTx = this.db,
  ): Promise<void> {
    const details = {
      reportCount: input.reporters,
      lastCategory: input.category,
      lastReportId: input.reportId,
    };
    await db.execute(sql`
      INSERT INTO moderation_items (id, target_type, target_id, source, severity, status, details, city_id)
      VALUES (${uuidv7()}, ${input.targetType}, ${input.targetId}, 'report', ${input.severity}, 'open', ${JSON.stringify(details)}::jsonb, ${input.cityId})
      ON CONFLICT (target_type, target_id, source) WHERE status = 'open' DO UPDATE SET
        severity = CASE
          WHEN array_position(ARRAY['low','medium','high','critical'], EXCLUDED.severity) > array_position(ARRAY['low','medium','high','critical'], moderation_items.severity)
          THEN EXCLUDED.severity ELSE moderation_items.severity END,
        details = moderation_items.details || EXCLUDED.details,
        updated_at = now()`);
  }

  /** Open items, most severe first, oldest first within a severity (F-WEB-03 moderation queue). */
  async queue(cursor: string | undefined, limit: number): Promise<Paginated<ModerationQueueItem>> {
    const rank = sql<number>`array_position(ARRAY['critical','high','medium','low'], ${moderationItems.severity})`;
    const after = cursor ? decodeCursor(cursor, QueueCursor) : null;
    const rows = await this.db
      .select({ item: moderationItems, rank })
      .from(moderationItems)
      .where(
        and(
          eq(moderationItems.status, 'open'),
          after
            ? sql`(${rank}, ${moderationItems.createdAt}, ${moderationItems.id}) > (${after.r}, ${new Date(after.t)}, ${after.id}::uuid)`
            : sql`true`,
        ),
      )
      .orderBy(asc(rank), asc(moderationItems.createdAt), asc(moderationItems.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(({ item }) => ({
        id: item.id,
        targetType: item.targetType,
        targetId: item.targetId,
        source: item.source,
        severity: item.severity,
        status: item.status,
        details: item.details,
        reportCount: typeof item.details.reportCount === 'number' ? item.details.reportCount : 0,
        createdAt: item.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ r: last.rank, t: last.item.createdAt.toISOString(), id: last.item.id })
          : null,
    };
  }
}

const QueueCursor = z.object({ r: z.number().int(), t: z.iso.datetime(), id: z.uuid() });
