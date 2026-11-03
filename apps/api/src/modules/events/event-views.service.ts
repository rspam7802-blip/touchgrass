import { Inject, Injectable } from '@nestjs/common';
import { zonedParts } from '@touchgrass/shared';
import { and, inArray, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DB, type Database } from '../../infra/database/database.module.js';
import { eventViews } from '../../infra/database/schema/index.js';
import { REDIS } from '../../infra/redis/redis.module.js';

const DAY_SECONDS = 26 * 3600;

/** IST calendar day as YYYY-MM-DD. */
export function istDay(at: Date): string {
  const p = zonedParts(at);
  return `${String(p.year)}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Distinct viewers per plan per IST day, for host analytics (F-HST-02). A Redis SET NX guard means repeat opens
 * the same day cost one Redis call and no database write.
 */
@Injectable()
export class EventViewsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async record(eventId: string, viewerId: string, now: Date = new Date()): Promise<void> {
    const day = istDay(now);
    const first = await this.redis.set(
      `views:${eventId}:${day}:${viewerId}`,
      '1',
      'EX',
      DAY_SECONDS,
      'NX',
    );
    if (first !== 'OK') return;
    await this.db.insert(eventViews).values({ eventId, viewerId, day }).onConflictDoNothing();
  }

  async counts(eventIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>(eventIds.map((id) => [id, 0]));
    if (eventIds.length === 0) return out;
    const rows = await this.db
      .select({ eventId: eventViews.eventId, n: sql<number>`count(*)::int` })
      .from(eventViews)
      .where(and(inArray(eventViews.eventId, eventIds)))
      .groupBy(eventViews.eventId);
    for (const r of rows) out.set(r.eventId, r.n);
    return out;
  }

  /** Account erasure: views are anonymous counts once the viewer is gone. */
  async eraseFor(viewerId: string, db: Pick<Database, 'execute'> = this.db): Promise<void> {
    await db.execute(sql`DELETE FROM event_views WHERE viewer_id = ${viewerId}`);
  }
}
