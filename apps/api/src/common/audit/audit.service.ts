import { Inject, Injectable } from '@nestjs/common';
import {
  type AuditEntry,
  decodeCursor,
  encodeCursor,
  type Paginated,
  TimeIdCursor,
} from '@touchgrass/shared';
import { desc, eq, lt, or, and, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { DB, type Database } from '../../infra/database/database.module.js';
import { adminActions, profiles } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { markAudited } from './audit-context.js';

export interface AuditRecord {
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details?: Record<string, unknown>;
}

/** Append-only admin audit log (F-SAF-05, F-WEB-03). Write it in the same transaction as the change. */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(entry: AuditRecord, db: DbOrTx = this.db): Promise<void> {
    await db.insert(adminActions).values({ id: uuidv7(), ...entry, details: entry.details ?? {} });
    markAudited();
  }

  async list(cursor: string | undefined, limit: number): Promise<Paginated<AuditEntry>> {
    const after = cursor ? decodeCursor(cursor, TimeIdCursor) : null;
    const rows = await this.db
      .select({ a: adminActions, adminName: profiles.displayName })
      .from(adminActions)
      .leftJoin(profiles, eq(profiles.userId, adminActions.adminUserId))
      .where(
        after
          ? or(
              lt(adminActions.createdAt, new Date(after.t)),
              and(eq(adminActions.createdAt, new Date(after.t)), lt(adminActions.id, after.id)),
            )
          : sql`true`,
      )
      .orderBy(desc(adminActions.createdAt), desc(adminActions.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(({ a, adminName }) => ({
        id: a.id,
        adminUserId: a.adminUserId,
        adminName,
        action: a.action,
        targetType: a.targetType,
        targetId: a.targetId,
        details: a.details,
        createdAt: a.createdAt.toISOString(),
      })),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ t: last.a.createdAt.toISOString(), id: last.a.id })
          : null,
    };
  }
}
