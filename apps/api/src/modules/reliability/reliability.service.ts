import { Inject, Injectable } from '@nestjs/common';
import { type ReliabilityKind, reliabilityOutcome } from '@touchgrass/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { reliabilityEvents, reliabilityScores } from '../../infra/database/schema/index.js';

const YEAR_MS = 365 * 86_400_000;

/**
 * Reliability ledger and score (F-SAF-02). Outcomes are recorded once per person, plan and kind (check-in,
 * no-show, late cancel); the score is recomputed after every change and nightly (older outcomes decay).
 */
@Injectable()
export class ReliabilityService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Idempotent. Returns true when the outcome was new. */
  async record(
    userId: string,
    eventId: string,
    kind: ReliabilityKind,
    at: Date,
    now: Date = new Date(),
  ): Promise<boolean> {
    const inserted = await this.db
      .insert(reliabilityEvents)
      .values({ userId, eventId, kind, at })
      .onConflictDoNothing()
      .returning({ userId: reliabilityEvents.userId });
    if (inserted.length > 0) await this.recompute(userId, now);
    return inserted.length > 0;
  }

  async recompute(
    userId: string,
    now: Date = new Date(),
    db: Database | Tx = this.db,
  ): Promise<void> {
    const rows = await db
      .select({ kind: reliabilityEvents.kind, at: reliabilityEvents.at })
      .from(reliabilityEvents)
      .where(
        and(
          eq(reliabilityEvents.userId, userId),
          gte(reliabilityEvents.at, new Date(now.getTime() - YEAR_MS)),
        ),
      );
    const o = reliabilityOutcome(rows, now);
    await db
      .insert(reliabilityScores)
      .values({
        userId,
        score: o.score,
        tier: o.tier,
        noShowsRecent: o.noShowsRecent,
        cooldownUntil: o.cooldownUntil,
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: reliabilityScores.userId,
        set: {
          score: o.score,
          tier: o.tier,
          noShowsRecent: o.noShowsRecent,
          cooldownUntil: o.cooldownUntil,
          computedAt: now,
        },
      });
  }

  /** Nightly: everyone with outcomes in the last year (decay changes scores even without new events). */
  async recomputeAll(now: Date = new Date()): Promise<number> {
    const res = await this.db.execute<{ user_id: string }>(sql`
      SELECT DISTINCT user_id FROM reliability_events WHERE at >= ${new Date(now.getTime() - YEAR_MS)}`);
    for (const r of res.rows) await this.recompute(r.user_id, now);
    return res.rows.length;
  }

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const [score] = await this.db
      .select({ tier: reliabilityScores.tier, cooldownUntil: reliabilityScores.cooldownUntil })
      .from(reliabilityScores)
      .where(eq(reliabilityScores.userId, userId));
    const events = await this.db
      .select({
        eventId: reliabilityEvents.eventId,
        kind: reliabilityEvents.kind,
        at: reliabilityEvents.at,
      })
      .from(reliabilityEvents)
      .where(eq(reliabilityEvents.userId, userId));
    return {
      reliability: {
        tier: score?.tier ?? 'new',
        cooldownUntil: score?.cooldownUntil?.toISOString() ?? null,
        outcomes: events.map((e) => ({ ...e, at: e.at.toISOString() })),
      },
    };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(reliabilityEvents).where(eq(reliabilityEvents.userId, userId));
    await tx.delete(reliabilityScores).where(eq(reliabilityScores.userId, userId));
  }
}
