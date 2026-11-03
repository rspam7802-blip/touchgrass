import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB_REPLICA, type Database } from '../../../infra/database/database.module.js';
import { uuidArrayLiteral } from '../../social/graph/social-graph.service.js';

export interface HostedEvent {
  id: string;
  title: string;
  startsAt: Date;
  status: string;
}

export interface Attendance {
  /** People holding a seat now (excluding hosts). */
  rsvps: number;
  checkIns: number;
  /** Finished plans only: seat holders who never checked in. */
  noShows: number;
  /** Attendees who had been to an earlier plan by the same host. */
  repeatAttendees: number;
}

/** Host analytics inputs over the events module's own tables (F-HST-02). Replica-backed, read-only. */
@Injectable()
export class HostEventStats {
  constructor(@Inject(DB_REPLICA) private readonly replica: Database) {}

  /** Plans someone hosts or co-hosts (not drafts), newest first. */
  async hostedEvents(hostId: string, limit: number): Promise<HostedEvent[]> {
    const res = await this.replica.execute<{
      id: string;
      title: string;
      starts_at: string | Date;
      status: string;
    }>(sql`
      SELECT e.id, e.title, e.starts_at, e.status
      FROM event_hosts h JOIN events e ON e.id = h.event_id
      WHERE h.user_id = ${hostId} AND h.role IN ('host', 'co_host') AND e.status <> 'draft'
      ORDER BY e.starts_at DESC LIMIT ${limit}`);
    return res.rows.map((r) => ({
      id: r.id,
      title: r.title,
      startsAt: new Date(r.starts_at),
      status: r.status,
    }));
  }

  async attendance(eventIds: string[], hostId: string): Promise<Map<string, Attendance>> {
    const out = new Map<string, Attendance>(
      eventIds.map((id) => [id, { rsvps: 0, checkIns: 0, noShows: 0, repeatAttendees: 0 }]),
    );
    if (eventIds.length === 0) return out;
    const res = await this.replica.execute<{
      event_id: string;
      rsvps: number;
      check_ins: number;
      no_shows: number;
      repeats: number;
    }>(sql`
      SELECT r.event_id,
        count(*) FILTER (WHERE r.status IN ('going', 'checked_in'))::int AS rsvps,
        count(*) FILTER (WHERE r.status = 'checked_in')::int AS check_ins,
        count(*) FILTER (WHERE r.status = 'going' AND e.status = 'completed')::int AS no_shows,
        count(*) FILTER (WHERE r.status IN ('going', 'checked_in') AND EXISTS (
          SELECT 1 FROM rsvps r2
          JOIN event_hosts h2 ON h2.event_id = r2.event_id AND h2.user_id = ${hostId} AND h2.role IN ('host', 'co_host')
          JOIN events e2 ON e2.id = r2.event_id
          WHERE r2.user_id = r.user_id AND r2.event_id <> r.event_id
            AND r2.status IN ('going', 'checked_in') AND e2.starts_at < e.starts_at
        ))::int AS repeats
      FROM rsvps r
      JOIN events e ON e.id = r.event_id
      WHERE r.event_id = ANY(${uuidArrayLiteral(eventIds)}::uuid[])
        AND NOT EXISTS (SELECT 1 FROM event_hosts h WHERE h.event_id = r.event_id AND h.user_id = r.user_id)
      GROUP BY r.event_id`);
    for (const r of res.rows)
      out.set(r.event_id, {
        rsvps: r.rsvps,
        checkIns: r.check_ins,
        noShows: r.no_shows,
        repeatAttendees: r.repeats,
      });
    return out;
  }
}
