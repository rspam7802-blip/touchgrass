import { Inject, Injectable } from '@nestjs/common';
import type { ProfileStats } from '@touchgrass/shared';
import { sql } from 'drizzle-orm';
import { DB_REPLICA, type Database } from '../../../infra/database/database.module.js';
import { ProfileStatsReader } from '../../profiles/profile-stats.port.js';
import { SharedEventsReader } from '../../social/shared-events.port.js';
import { uuidArrayLiteral } from '../../social/graph/social-graph.service.js';
import { ReliabilityReader } from '../../reliability/reliability-reader.js';

/** Profile stats (F-ACC-05): attendance from RSVPs and hosting, tier from the reliability score (F-SAF-02). */
@Injectable()
export class EventProfileStats extends ProfileStatsReader {
  constructor(
    @Inject(DB_REPLICA) private readonly replica: Database,
    private readonly reliability: ReliabilityReader,
  ) {
    super();
  }

  async statsFor(userIds: string[]): Promise<Map<string, ProfileStats>> {
    const out = new Map<string, ProfileStats>();
    if (userIds.length === 0) return out;
    const ids = uuidArrayLiteral(userIds);
    const tiers = await this.reliability.tiers(userIds);
    const res = await this.replica.execute<{
      id: string;
      attended: number;
      hosted: number;
    }>(sql`
      SELECT u.id,
        (SELECT count(*)::int FROM rsvps r WHERE r.user_id = u.id AND r.status = 'checked_in') AS attended,
        (SELECT count(*)::int FROM event_hosts h JOIN events e ON e.id = h.event_id
          WHERE h.user_id = u.id AND h.role = 'host' AND e.status = 'completed') AS hosted
      FROM unnest(${ids}::uuid[]) AS u(id)`);
    for (const r of res.rows) {
      out.set(r.id, {
        eventsAttended: r.attended,
        eventsHosted: r.hosted,
        reliabilityTier: tiers.get(r.id) ?? 'new',
      });
    }
    return out;
  }
}

/** "Pulled up together": events both people checked in to (suggestions, F-SOC-03). */
@Injectable()
export class EventSharedEvents extends SharedEventsReader {
  constructor(@Inject(DB_REPLICA) private readonly replica: Database) {
    super();
  }

  async sharedEventCounts(userId: string, others: string[]): Promise<Map<string, number>> {
    if (others.length === 0) return new Map();
    const res = await this.replica.execute<{ id: string; n: number }>(sql`
      SELECT b.user_id AS id, count(*)::int AS n
      FROM rsvps a JOIN rsvps b ON b.event_id = a.event_id AND b.status = 'checked_in'
      WHERE a.user_id = ${userId} AND a.status = 'checked_in' AND b.user_id = ANY(${uuidArrayLiteral(others)}::uuid[])
      GROUP BY b.user_id`);
    return new Map(res.rows.map((r) => [r.id, r.n]));
  }

  async coAttendees(userId: string, limit: number): Promise<{ id: string; shared: number }[]> {
    const res = await this.replica.execute<{ id: string; shared: number }>(sql`
      SELECT b.user_id AS id, count(*)::int AS shared
      FROM rsvps a JOIN rsvps b ON b.event_id = a.event_id AND b.status = 'checked_in' AND b.user_id <> a.user_id
      WHERE a.user_id = ${userId} AND a.status = 'checked_in'
      GROUP BY b.user_id ORDER BY shared DESC, b.user_id LIMIT ${limit}`);
    return res.rows;
  }
}
