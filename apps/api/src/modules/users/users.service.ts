import { Inject, Injectable } from '@nestjs/common';
import { hashPhoneE164, type SupportedLanguage, type UserStatus } from '@touchgrass/shared';
import { and, asc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { DB, type Database } from '../../infra/database/database.module.js';
import { userRoles, users } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { REDIS } from '../../infra/redis/redis.module.js';

export type UserRow = typeof users.$inferSelect;
const STATUS_CACHE_TTL = 60;

/** Owns the `users` and `user_roles` tables. Other modules go through this service. */
@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async findById(id: string, db: DbOrTx = this.db): Promise<UserRow | null> {
    const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
    return row ?? null;
  }

  async findByPhone(phoneE164: string, db: DbOrTx = this.db): Promise<UserRow | null> {
    // Lookup by hash so age-blocked accounts (raw number erased) are still recognised.
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.phoneHash, hashPhoneE164(phoneE164)))
      .limit(1);
    return row ?? null;
  }

  async createFromPhone(
    phoneE164: string,
    invitedByUserId: string | null,
    tx: DbOrTx,
  ): Promise<UserRow> {
    const [row] = await tx
      .insert(users)
      .values({
        id: uuidv7(),
        phoneE164,
        phoneHash: hashPhoneE164(phoneE164),
        status: 'onboarding',
        language: 'en',
        invitedByUserId,
      })
      .returning();
    if (!row) throw new Error('Failed to create user');
    return row;
  }

  async setInvitedBy(userId: string, inviterUserId: string, db: DbOrTx = this.db): Promise<void> {
    await db.update(users).set({ invitedByUserId: inviterUserId }).where(eq(users.id, userId));
  }

  async rolesOf(userId: string, db: DbOrTx = this.db): Promise<string[]> {
    const rows = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, userId));
    return [...new Set(rows.map((r) => r.role))].sort();
  }

  /** Cities this person curates (F-GRW-03); empty unless they hold `city_curator`. */
  async curatorCities(userId: string, db: DbOrTx = this.db): Promise<string[]> {
    const rows = await db
      .select({ cityId: userRoles.cityId })
      .from(userRoles)
      .where(and(eq(userRoles.userId, userId), eq(userRoles.role, 'city_curator')));
    return rows.flatMap((r) => (r.cityId ? [r.cityId] : []));
  }

  /** Every admin role held by anyone, oldest first (the team page). */
  async allRoles(db: DbOrTx = this.db): Promise<(typeof userRoles.$inferSelect)[]> {
    return db.select().from(userRoles).orderBy(asc(userRoles.createdAt), asc(userRoles.id));
  }

  async roleById(id: string, db: DbOrTx = this.db): Promise<typeof userRoles.$inferSelect | null> {
    const [row] = await db.select().from(userRoles).where(eq(userRoles.id, id)).limit(1);
    return row ?? null;
  }

  async revokeRole(id: string, db: DbOrTx = this.db): Promise<void> {
    await db.delete(userRoles).where(eq(userRoles.id, id));
  }

  async countRole(
    role: (typeof userRoles.$inferInsert)['role'],
    db: DbOrTx = this.db,
  ): Promise<number> {
    const rows = await db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(eq(userRoles.role, role));
    return rows.length;
  }

  async grantRole(
    userId: string,
    role: (typeof userRoles.$inferInsert)['role'],
    cityId: string | null,
    db: DbOrTx = this.db,
  ): Promise<void> {
    await db.insert(userRoles).values({ id: uuidv7(), userId, role, cityId }).onConflictDoNothing();
  }

  async setStatus(
    userId: string,
    status: UserStatus,
    db: DbOrTx = this.db,
    extra: Partial<typeof users.$inferInsert> = {},
  ): Promise<void> {
    await db
      .update(users)
      .set({ status, ...extra })
      .where(eq(users.id, userId));
    await this.redis.del(`user-status:${userId}`);
  }

  async setLanguage(userId: string, language: SupportedLanguage): Promise<void> {
    await this.db.update(users).set({ language }).where(eq(users.id, userId));
  }

  async setCity(userId: string, cityId: string, db: DbOrTx = this.db): Promise<void> {
    await db.update(users).set({ cityId }).where(eq(users.id, userId));
  }

  /** Where receipts go (F-PAY-05); `null` stops receipt emails. */
  async setReceiptEmail(userId: string, email: string | null, db: DbOrTx = this.db): Promise<void> {
    await db.update(users).set({ receiptEmail: email }).where(eq(users.id, userId));
  }

  async touchActive(userId: string): Promise<void> {
    await this.db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, userId));
  }

  /** Cached status for the per-request onboarding/active check. */
  async statusOf(userId: string): Promise<UserStatus | null> {
    const cached = await this.redis.get(`user-status:${userId}`);
    if (cached) return cached as UserStatus;
    const user = await this.findById(userId);
    if (!user) return null;
    await this.redis.set(`user-status:${userId}`, user.status, 'EX', STATUS_CACHE_TTL);
    return user.status;
  }

  async languages(ids: string[]): Promise<Map<string, SupportedLanguage>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: users.id, language: users.language })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((r) => [r.id, r.language]));
  }

  async byIds(ids: string[]): Promise<UserRow[]> {
    if (ids.length === 0) return [];
    return this.db.select().from(users).where(inArray(users.id, ids));
  }

  /** Verified badge (F-SAF-01): set when a reviewer approves a selfie, cleared when an admin revokes it. */
  async setVerifiedAt(userId: string, at: Date | null, db: DbOrTx = this.db): Promise<void> {
    await db.update(users).set({ verifiedAt: at }).where(eq(users.id, userId));
  }

  async verifiedIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), isNotNull(users.verifiedAt)));
    return new Set(rows.map((r) => r.id));
  }

  /** Active accounts whose phone hash is in the given set (contact matching, F-SOC-01). */
  async activeIdsByPhoneHashes(hashes: string[]): Promise<Map<string, string>> {
    if (hashes.length === 0) return new Map();
    const out = new Map<string, string>();
    for (let i = 0; i < hashes.length; i += 1000) {
      const rows = await this.db
        .select({ id: users.id, hash: users.phoneHash })
        .from(users)
        .where(
          and(inArray(users.phoneHash, hashes.slice(i, i + 1000)), eq(users.status, 'active')),
        );
      for (const r of rows) if (r.hash) out.set(r.hash, r.id);
    }
    return out;
  }

  async phoneHashOf(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ hash: users.phoneHash })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.hash ?? null;
  }

  async activeIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, ids), eq(users.status, 'active'), isNull(users.deletedAt)));
    return new Set(rows.map((r) => r.id));
  }
}
