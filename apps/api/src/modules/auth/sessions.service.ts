import { Inject, Injectable } from '@nestjs/common';
import { type AuthTokens, type DeviceInfo, LIMITS, type SessionSummary } from '@touchgrass/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { signAccessToken } from '../../common/auth/jwt.js';
import { pepperedHash, randomToken } from '../../common/auth/hashing.js';
import { SessionRevocationService } from '../../common/auth/revocation.service.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { refreshTokens, userSessions } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';

export type RefreshOutcome =
  | { kind: 'rotated'; tokens: AuthTokens; userId: string }
  | { kind: 'reuse_detected'; sessionId: string }
  | { kind: 'invalid' };

/**
 * Per-device sessions with rotating refresh tokens (F-ACC-02).
 * Refresh tokens are 256-bit random strings stored only as peppered hashes. Each use rotates the token;
 * presenting an already-rotated token means it was stolen or replayed, so the whole session is revoked.
 */
@Injectable()
export class SessionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly revocations: SessionRevocationService,
  ) {}

  private hash(token: string): string {
    return pepperedHash(this.env.TOKEN_HASH_PEPPER, `refresh:${token}`);
  }

  private issueAccess(
    userId: string,
    sessionId: string,
    roles: string[],
    now: Date,
  ): { accessToken: string; accessTokenExpiresAt: string } {
    const ttl = LIMITS.tokens.accessTtlSeconds;
    return {
      accessToken: signAccessToken(
        { sub: userId, sid: sessionId, roles },
        this.env.JWT_ACCESS_SECRET,
        ttl,
        now,
      ),
      accessTokenExpiresAt: new Date(
        Math.floor(now.getTime() / 1000) * 1000 + ttl * 1000,
      ).toISOString(),
    };
  }

  private async insertRefresh(sessionId: string, tx: DbOrTx, now: Date): Promise<string> {
    const token = randomToken(32);
    await tx.insert(refreshTokens).values({
      id: uuidv7(),
      sessionId,
      tokenHash: this.hash(token),
      expiresAt: new Date(now.getTime() + LIMITS.tokens.refreshTtlSeconds * 1000),
    });
    return token;
  }

  /** Creates a session for a device. Signing in again on the same device replaces its old session. */
  async create(
    userId: string,
    device: DeviceInfo,
    roles: string[],
    ip: string | null,
    tx: DbOrTx,
    now: Date = new Date(),
  ): Promise<AuthTokens> {
    const replaced = await tx
      .update(userSessions)
      .set({ revokedAt: now, revokedReason: 'replaced' })
      .where(
        and(
          eq(userSessions.userId, userId),
          eq(userSessions.deviceId, device.deviceId),
          isNull(userSessions.revokedAt),
        ),
      )
      .returning({ id: userSessions.id });

    const sessionId = uuidv7();
    await tx.insert(userSessions).values({
      id: sessionId,
      userId,
      deviceId: device.deviceId,
      deviceName: device.name,
      platform: device.platform,
      appVersion: device.appVersion,
      ip,
      lastUsedAt: now,
    });

    // Keep the number of live sessions bounded: evict the least recently used.
    const active = await tx
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
      .orderBy(asc(userSessions.lastUsedAt));
    const evict = active
      .slice(0, Math.max(0, active.length - LIMITS.sessions.maxActivePerUser))
      .map((s) => s.id);
    if (evict.length > 0) {
      await tx
        .update(userSessions)
        .set({ revokedAt: now, revokedReason: 'evicted' })
        .where(inArray(userSessions.id, evict));
    }
    await this.revocations.revoke([...replaced.map((r) => r.id), ...evict]);

    const refreshToken = await this.insertRefresh(sessionId, tx, now);
    return { ...this.issueAccess(userId, sessionId, roles, now), refreshToken, sessionId };
  }

  async refresh(
    token: string,
    rolesOf: (userId: string) => Promise<string[]>,
    now: Date = new Date(),
  ): Promise<RefreshOutcome> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: refreshTokens.id,
          sessionId: refreshTokens.sessionId,
          rotatedAt: refreshTokens.rotatedAt,
          expiresAt: refreshTokens.expiresAt,
          userId: userSessions.userId,
          revokedAt: userSessions.revokedAt,
        })
        .from(refreshTokens)
        .innerJoin(userSessions, eq(userSessions.id, refreshTokens.sessionId))
        .where(eq(refreshTokens.tokenHash, this.hash(token)))
        .for('update')
        .limit(1);
      if (!row || row.revokedAt || row.expiresAt.getTime() <= now.getTime())
        return { kind: 'invalid' } as const;
      if (row.rotatedAt) {
        await tx
          .update(userSessions)
          .set({ revokedAt: now, revokedReason: 'refresh_reuse' })
          .where(eq(userSessions.id, row.sessionId));
        await this.revocations.revoke([row.sessionId]);
        return { kind: 'reuse_detected', sessionId: row.sessionId } as const;
      }
      await tx.update(refreshTokens).set({ rotatedAt: now }).where(eq(refreshTokens.id, row.id));
      await tx
        .update(userSessions)
        .set({ lastUsedAt: now })
        .where(eq(userSessions.id, row.sessionId));
      const refreshToken = await this.insertRefresh(row.sessionId, tx, now);
      const roles = await rolesOf(row.userId);
      return {
        kind: 'rotated',
        userId: row.userId,
        tokens: {
          ...this.issueAccess(row.userId, row.sessionId, roles, now),
          refreshToken,
          sessionId: row.sessionId,
        },
      } as const;
    });
  }

  /** Whether this person has ever signed in on that device (referral fraud check, F-GRW-01). */
  async hasDevice(userId: string, deviceId: string, db: DbOrTx = this.db): Promise<boolean> {
    const [row] = await db
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(and(eq(userSessions.userId, userId), eq(userSessions.deviceId, deviceId)))
      .limit(1);
    return Boolean(row);
  }

  async list(userId: string, currentSessionId: string): Promise<SessionSummary[]> {
    const rows = await this.db
      .select()
      .from(userSessions)
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
      .orderBy(desc(userSessions.lastUsedAt));
    return rows.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      platform: s.platform,
      appVersion: s.appVersion,
      createdAt: s.createdAt.toISOString(),
      lastUsedAt: s.lastUsedAt.toISOString(),
      current: s.id === currentSessionId,
    }));
  }

  async revoke(userId: string, sessionId: string, reason: string): Promise<void> {
    const rows = await this.db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(
        and(
          eq(userSessions.id, sessionId),
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
        ),
      )
      .returning({ id: userSessions.id });
    if (rows.length === 0) throw AppError.notFound('Session');
    await this.revocations.revoke([sessionId]);
  }

  /** Revokes every live session of a user (suspension, ban, deletion, age block). */
  async revokeAll(userId: string, reason: string, db: DbOrTx = this.db): Promise<number> {
    const rows = await db
      .update(userSessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)))
      .returning({ id: userSessions.id });
    await this.revocations.revoke(rows.map((r) => r.id));
    return rows.length;
  }
}
