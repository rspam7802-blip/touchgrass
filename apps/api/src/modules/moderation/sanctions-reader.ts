import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, max } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { userSanctions } from '../../infra/database/schema/index.js';

/** Read side of sanctions, for content modules: a muted person can't post or message (F-SAF-05). */
@Injectable()
export class SanctionsReader {
  constructor(@Inject(DB) private readonly db: Database) {}

  async mutedUntil(userId: string, now: Date = new Date()): Promise<Date | null> {
    const [row] = await this.db
      .select({ until: max(userSanctions.until) })
      .from(userSanctions)
      .where(
        and(
          eq(userSanctions.userId, userId),
          eq(userSanctions.kind, 'mute'),
          isNull(userSanctions.liftedAt),
          gt(userSanctions.until, now),
        ),
      );
    return row?.until ?? null;
  }

  async assertCanPost(userId: string, now: Date = new Date()): Promise<void> {
    const until = await this.mutedUntil(userId, now);
    if (until)
      throw new AppError('FORBIDDEN', 'Muted', { reason: 'MUTED', until: until.toISOString() });
  }
}
