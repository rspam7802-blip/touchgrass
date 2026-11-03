import { Inject, Injectable } from '@nestjs/common';
import { type AdminUserDetail, type AdminUserSummary, normalizeE164 } from '@touchgrass/shared';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { moderationItems } from '../../infra/database/schema/index.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { type UserRow, UsersService } from '../users/users.service.js';
import { SanctionsService } from './sanctions.service.js';

const SEARCH_LIMIT = 20;
const isUuid = (q: string) => z.uuid().safeParse(q).success;

/** Finding people and seeing their standing (F-WEB-03 users page): history, open mutes, reports, badge. */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly people: PeopleService,
    private readonly sanctions: SanctionsService,
    private readonly audit: AuditService,
  ) {}

  private async summaries(rows: UserRow[]): Promise<AdminUserSummary[]> {
    const names = await this.profiles.displayNames(rows.map((r) => r.id));
    return rows.map((u) => ({
      id: u.id,
      displayName: names.get(u.id) ?? null,
      phoneLast4: u.phoneE164 ? u.phoneE164.slice(-4) : null,
      status: u.status,
      verified: u.verifiedAt !== null,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  /** By user ID, by phone number, or by name. */
  async search(q: string): Promise<AdminUserSummary[]> {
    const phone = normalizeE164(q);
    let rows: UserRow[];
    if (isUuid(q)) {
      const u = await this.users.findById(q);
      rows = u ? [u] : [];
    } else if (phone) {
      const u = await this.users.findByPhone(phone);
      rows = u ? [u] : [];
    } else {
      const ids = await this.profiles.searchByName(q, SEARCH_LIMIT);
      const found = await this.users.byIds(ids);
      rows = ids.flatMap((id) => found.filter((u) => u.id === id));
    }
    return this.summaries(rows);
  }

  async detail(adminId: string, userId: string, now: Date = new Date()): Promise<AdminUserDetail> {
    const user = await this.users.findById(userId);
    if (!user) throw AppError.notFound('User');
    const [[summary], roles, history, active, cards, reports] = await Promise.all([
      this.summaries([user]),
      this.users.rolesOf(userId),
      this.sanctions.history(userId),
      this.sanctions.activeUntil(userId, now),
      this.people.cards(adminId, [userId], { includeSelf: true }),
      this.db
        .select({
          n: sql<number>`coalesce(sum(coalesce((${moderationItems.details}->>'reportCount')::int, 0)), 0)::int`,
        })
        .from(moderationItems)
        .where(
          and(
            eq(moderationItems.targetType, 'user'),
            eq(moderationItems.targetId, userId),
            eq(moderationItems.source, 'report'),
          ),
        ),
    ]);
    if (!summary) throw AppError.notFound('User');
    return {
      ...summary,
      person: cards.get(userId) ?? null,
      roles,
      sanctions: history,
      reportsAgainst: reports[0]?.n ?? 0,
      mutedUntil: active.mutedUntil?.toISOString() ?? null,
      suspendedUntil: active.suspendedUntil?.toISOString() ?? null,
    };
  }

  /** Manual badge changes (a reviewer verified in person, or a badge was obtained by deception). */
  async setVerified(adminId: string, userId: string, verified: boolean): Promise<AdminUserDetail> {
    const user = await this.users.findById(userId);
    if (!user || user.status === 'deleted') throw AppError.notFound('User');
    await this.db.transaction(async (tx) => {
      await this.users.setVerifiedAt(userId, verified ? (user.verifiedAt ?? new Date()) : null, tx);
      await this.audit.record(
        {
          adminUserId: adminId,
          action: verified ? 'users.verify' : 'users.unverify',
          targetType: 'user',
          targetId: userId,
        },
        tx,
      );
    });
    return this.detail(adminId, userId);
  }
}
