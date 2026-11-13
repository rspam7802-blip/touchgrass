import { Inject, Injectable } from '@nestjs/common';
import {
  type BulkInviteBody,
  decodeCursor,
  encodeCursor,
  type InviteCode,
  LIMITS,
  type MyInvites,
  type Paginated,
  TimeIdCursor,
} from '@touchgrass/shared';
import { and, count, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { randomInviteCode } from '../../common/auth/hashing.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import {
  inviteCodes,
  inviteRedemptions,
  profiles,
  users,
} from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { AppSettingsService } from '../platform/app-settings.service.js';

type InviteRow = typeof inviteCodes.$inferSelect;

export function toInviteDto(row: InviteRow): InviteCode {
  return {
    id: row.id,
    code: row.code,
    maxUses: row.maxUses,
    uses: row.uses,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revoked: row.revokedAt !== null,
    label: row.label,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Pure usability check, shared by `check` and `redeem` (unit tested). */
export function isInviteUsable(
  row: Pick<InviteRow, 'uses' | 'maxUses' | 'revokedAt' | 'expiresAt'>,
  now: Date,
): boolean {
  return (
    row.revokedAt === null &&
    row.uses < row.maxUses &&
    (row.expiresAt === null || row.expiresAt.getTime() > now.getTime())
  );
}

/** Invite-only beta (F-ACC-01): per-user quotas, single/multi-use codes with expiry, invite tree, admin bulk codes. */
@Injectable()
export class InvitesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly settings: AppSettingsService,
  ) {}

  async check(
    code: string,
    now: Date = new Date(),
  ): Promise<{ valid: boolean; inviterName: string | null }> {
    const [row] = await this.db
      .select({ invite: inviteCodes, inviterName: profiles.displayName })
      .from(inviteCodes)
      .leftJoin(profiles, eq(profiles.userId, inviteCodes.createdByUserId))
      .where(eq(inviteCodes.code, code))
      .limit(1);
    if (!row || !isInviteUsable(row.invite, now)) return { valid: false, inviterName: null };
    return { valid: true, inviterName: row.invite.source === 'user' ? row.inviterName : null };
  }

  /**
   * Atomically consumes one use. The guarded UPDATE makes concurrent redemptions of the last use safe:
   * exactly one succeeds. Returns the inviter (null for admin codes).
   */
  async redeem(
    code: string,
    userId: string,
    tx: DbOrTx,
    now: Date = new Date(),
  ): Promise<{ inviteCodeId: string; inviterUserId: string | null }> {
    const [row] = await tx
      .update(inviteCodes)
      .set({ uses: sql`${inviteCodes.uses} + 1` })
      .where(
        and(
          eq(inviteCodes.code, code),
          isNull(inviteCodes.revokedAt),
          lt(inviteCodes.uses, inviteCodes.maxUses),
          or(isNull(inviteCodes.expiresAt), gt(inviteCodes.expiresAt, now)),
        ),
      )
      .returning({
        id: inviteCodes.id,
        createdBy: inviteCodes.createdByUserId,
        source: inviteCodes.source,
      });
    if (!row) throw new AppError('INVITE_INVALID', 'Invite code is invalid, used up or expired');
    await tx.insert(inviteRedemptions).values({ id: uuidv7(), inviteCodeId: row.id, userId });
    return { inviteCodeId: row.id, inviterUserId: row.source === 'user' ? row.createdBy : null };
  }

  private async quotaFor(userId: string, db: DbOrTx): Promise<number> {
    const [user] = await db
      .select({ override: users.inviteQuotaOverride })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user?.override ?? (await this.settings.get('invites_per_user', db));
  }

  async mine(userId: string): Promise<MyInvites> {
    const rows = await this.db
      .select()
      .from(inviteCodes)
      .where(eq(inviteCodes.createdByUserId, userId))
      .orderBy(desc(inviteCodes.createdAt));
    const quota = await this.quotaFor(userId, this.db);
    return {
      quota,
      remaining: Math.max(0, quota - rows.length),
      items: rows.map(toInviteDto),
      shareUrlBase: `${this.env.WEB_PUBLIC_URL}/invite`,
    };
  }

  /** Users get single-use codes up to their quota. Serialised per user with an advisory lock. */
  async createForUser(userId: string): Promise<InviteCode> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`invites:${userId}`}))`);
      const [{ value: used } = { value: 0 }] = await tx
        .select({ value: count() })
        .from(inviteCodes)
        .where(eq(inviteCodes.createdByUserId, userId));
      if (used >= (await this.quotaFor(userId, tx)))
        throw new AppError('INVITE_QUOTA_EXHAUSTED', 'No invites left');
      const expiresAt = new Date(Date.now() + LIMITS.invites.defaultExpiryDays * 86_400_000);
      return toInviteDto(
        await this.insertUnique(tx, {
          createdByUserId: userId,
          source: 'user',
          maxUses: 1,
          expiresAt,
          label: null,
        }),
      );
    });
  }

  async createBulk(adminUserId: string, body: BulkInviteBody, tx: DbOrTx): Promise<InviteCode[]> {
    const out: InviteCode[] = [];
    for (let i = 0; i < body.count; i += 1) {
      out.push(
        toInviteDto(
          await this.insertUnique(tx, {
            createdByUserId: adminUserId,
            source: 'admin',
            maxUses: body.maxUses,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            label: body.label,
          }),
        ),
      );
    }
    return out;
  }

  async revoke(id: string, tx: DbOrTx): Promise<InviteCode> {
    const [row] = await tx
      .update(inviteCodes)
      .set({ revokedAt: new Date() })
      .where(eq(inviteCodes.id, id))
      .returning();
    if (!row) throw AppError.notFound('Invite code');
    return toInviteDto(row);
  }

  /** Revokes every unused code a user created (account deletion). */
  async revokeAllBy(userId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(inviteCodes)
      .set({ revokedAt: new Date() })
      .where(and(eq(inviteCodes.createdByUserId, userId), isNull(inviteCodes.revokedAt)));
  }

  async list(cursor: string | undefined, limit: number): Promise<Paginated<InviteCode>> {
    const after = cursor ? decodeCursor(cursor, TimeIdCursor) : null;
    const rows = await this.db
      .select()
      .from(inviteCodes)
      .where(
        after
          ? or(
              lt(inviteCodes.createdAt, new Date(after.t)),
              and(eq(inviteCodes.createdAt, new Date(after.t)), lt(inviteCodes.id, after.id)),
            )
          : sql`true`,
      )
      .orderBy(desc(inviteCodes.createdAt), desc(inviteCodes.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map(toInviteDto),
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /** Code strings by id (the launch waitlist shows which code each person got). */
  async codesByIds(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: inviteCodes.id, code: inviteCodes.code })
      .from(inviteCodes)
      .where(inArray(inviteCodes.id, [...ids]));
    return new Map(rows.map((r) => [r.id, r.code]));
  }

  /** Who used each of these codes and when (waitlist funnel, D-191). */
  async redemptionsByCodeIds(
    ids: readonly string[],
  ): Promise<Map<string, { userId: string; at: Date }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        codeId: inviteRedemptions.inviteCodeId,
        userId: inviteRedemptions.userId,
        at: inviteRedemptions.createdAt,
      })
      .from(inviteRedemptions)
      .where(inArray(inviteRedemptions.inviteCodeId, [...ids]));
    return new Map(rows.map((r) => [r.codeId, { userId: r.userId, at: r.at }]));
  }

  /** Invite tree: who was invited by this user (and through which code). */
  async inviteesOf(userId: string): Promise<{ userId: string; redeemedAt: string }[]> {
    const rows = await this.db
      .select({ userId: inviteRedemptions.userId, at: inviteRedemptions.createdAt })
      .from(inviteRedemptions)
      .innerJoin(inviteCodes, eq(inviteCodes.id, inviteRedemptions.inviteCodeId))
      .where(eq(inviteCodes.createdByUserId, userId));
    return rows.map((r) => ({ userId: r.userId, redeemedAt: r.at.toISOString() }));
  }

  /** When this person redeemed the invite code that let them in, if they used one. */
  async redeemedAt(userId: string): Promise<Date | null> {
    const [row] = await this.db
      .select({ at: inviteRedemptions.createdAt })
      .from(inviteRedemptions)
      .where(eq(inviteRedemptions.userId, userId))
      .limit(1);
    return row?.at ?? null;
  }

  private async insertUnique(
    tx: DbOrTx,
    values: Omit<typeof inviteCodes.$inferInsert, 'id' | 'code'>,
  ): Promise<InviteRow> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const raw = randomInviteCode(LIMITS.invites.codeLength);
      const code = `${raw.slice(0, 4)}-${raw.slice(4)}`;
      const [row] = await tx
        .insert(inviteCodes)
        .values({ id: uuidv7(), code, ...values })
        .onConflictDoNothing({ target: inviteCodes.code })
        .returning();
      if (row) return row;
    }
    throw new Error('Could not generate a unique invite code');
  }
}
