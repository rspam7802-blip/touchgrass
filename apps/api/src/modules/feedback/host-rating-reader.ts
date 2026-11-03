import { Inject, Injectable, Module } from '@nestjs/common';
import { averageRating, type HostRatingSummary, LIMITS } from '@touchgrass/shared';
import { inArray, sql } from 'drizzle-orm';
import { DB_REPLICA, type Database } from '../../infra/database/database.module.js';
import { hostRatings } from '../../infra/database/schema/index.js';

/**
 * Host ratings (F-AFT-05) for profiles and discovery ranking. No module dependencies, so profiles and
 * discovery can read it without import cycles. Averages show only from `minRatingsToShow` ratings.
 */
@Injectable()
export class HostRatingReader {
  constructor(@Inject(DB_REPLICA) private readonly replica: Database) {}

  async summaries(hostIds: string[]): Promise<Map<string, HostRatingSummary>> {
    const out = new Map<string, HostRatingSummary>();
    if (hostIds.length === 0) return out;
    const rows = await this.replica
      .select({
        hostId: hostRatings.hostUserId,
        sum: sql<number>`sum(${hostRatings.rating})::int`,
        n: sql<number>`count(*)::int`,
      })
      .from(hostRatings)
      .where(inArray(hostRatings.hostUserId, [...new Set(hostIds)]))
      .groupBy(hostRatings.hostUserId);
    for (const r of rows)
      out.set(r.hostId, {
        average: r.n >= LIMITS.after.minRatingsToShow ? averageRating(r.sum, r.n) : null,
        count: r.n,
      });
    return out;
  }
}

@Module({ providers: [HostRatingReader], exports: [HostRatingReader] })
export class HostRatingReaderModule {}
