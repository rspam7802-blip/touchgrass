import { Inject, Injectable, Module } from '@nestjs/common';
import type { ReliabilityTier } from '@touchgrass/shared';
import { inArray, eq } from 'drizzle-orm';
import { DB, type Database } from '../../infra/database/database.module.js';
import { reliabilityScores } from '../../infra/database/schema/index.js';

/**
 * Read side of reliability (F-SAF-02), with no module dependencies so events and profiles can use it without
 * import cycles. People with no score yet are "new" and have no cooldown.
 */
@Injectable()
export class ReliabilityReader {
  constructor(@Inject(DB) private readonly db: Database) {}

  async tiers(userIds: string[]): Promise<Map<string, ReliabilityTier>> {
    const out = new Map<string, ReliabilityTier>(userIds.map((id) => [id, 'new']));
    if (userIds.length === 0) return out;
    const rows = await this.db
      .select({ userId: reliabilityScores.userId, tier: reliabilityScores.tier })
      .from(reliabilityScores)
      .where(inArray(reliabilityScores.userId, userIds));
    for (const r of rows) out.set(r.userId, r.tier);
    return out;
  }

  /** End of the person's cooldown on popular plans, if one is running. */
  async cooldownUntil(userId: string, now: Date = new Date()): Promise<Date | null> {
    const [row] = await this.db
      .select({ until: reliabilityScores.cooldownUntil })
      .from(reliabilityScores)
      .where(eq(reliabilityScores.userId, userId))
      .limit(1);
    return row?.until && row.until > now ? row.until : null;
  }
}

@Module({ providers: [ReliabilityReader], exports: [ReliabilityReader] })
export class ReliabilityReaderModule {}
