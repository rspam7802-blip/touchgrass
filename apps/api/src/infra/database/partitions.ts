import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DB, type Database } from './database.module.js';

/**
 * Monthly-partitioned, append-only tables and how long each keeps data (months). Later phases add chat
 * messages and notifications here. Retention drops whole partitions (no row-by-row deletes, no bloat).
 */
export const PARTITIONED_TABLES: readonly { table: string; retainMonths: number | null }[] = [
  // Chat history is the user's own record: kept until they delete it or their account (null = keep).
  { table: 'messages', retainMonths: null },
  // Ranking signals: six months is enough to tune weights; older behaviour is not kept (DPDP minimisation).
  { table: 'discovery_impressions', retainMonths: 6 },
  { table: 'discovery_clicks', retainMonths: 12 },
];
const MONTHS_AHEAD = 2;

@Injectable()
export class PartitionService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Daily: make sure the next months exist and drop expired ones. Returns partitions created + dropped. */
  async maintain(): Promise<number> {
    let changed = 0;
    for (const { table, retainMonths } of PARTITIONED_TABLES) {
      const created = await this.db.execute<{ n: number }>(
        sql`SELECT ensure_monthly_partitions(${table}, ${MONTHS_AHEAD}) AS n`,
      );
      changed += created.rows[0]?.n ?? 0;
      if (retainMonths === null) continue;
      const dropped = await this.db.execute<{ n: number }>(
        sql`SELECT drop_monthly_partitions_before(${table}, ${retainMonths}) AS n`,
      );
      changed += dropped.rows[0]?.n ?? 0;
    }
    return changed;
  }
}
