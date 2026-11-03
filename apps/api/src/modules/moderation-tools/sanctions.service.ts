import { Inject, Injectable, Logger } from '@nestjs/common';
import { type SanctionBody, type UserSanction } from '@touchgrass/shared';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { userSanctions } from '../../infra/database/schema/index.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { UsersService } from '../users/users.service.js';
import { type AfterCommit } from '../moderation/moderation-targets.js';

const DAY_MS = 86_400_000;
/** People who run moderation can't be sanctioned from the tools they use (ask a super admin). */
const STAFF_ROLES = ['moderator', 'admin', 'super_admin', 'support'];

export type SanctionRow = typeof userSanctions.$inferSelect;

/**
 * Warnings, mutes, suspensions and bans (F-SAF-05). Every change is audited in the same transaction.
 * Mute: no posting or messaging until it ends (content modules check `SanctionsReader`). Suspend: signed out and
 * locked out until it ends (the worker lifts it). Ban: signed out for good.
 */
@Injectable()
export class SanctionsService {
  private readonly logger = new Logger(SanctionsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly users: UsersService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly profiles: ProfilesService,
  ) {}

  /** Applies a sanction inside the caller's transaction; returns the notice to send once it has committed. */
  async apply(
    adminId: string,
    userId: string,
    body: SanctionBody,
    tx: Tx,
    opts: { moderationItemId?: string | null; now?: Date } = {},
  ): Promise<AfterCommit> {
    const now = opts.now ?? new Date();
    const user = await this.users.findById(userId, tx);
    if (!user || user.status === 'deleted') throw AppError.notFound('User');
    const roles = await this.users.rolesOf(userId, tx);
    if (userId === adminId || roles.some((r) => STAFF_ROLES.includes(r)))
      throw new AppError('FORBIDDEN', 'Staff accounts are managed elsewhere', {
        reason: 'STAFF_ACCOUNT',
      });
    const until = body.days !== null ? new Date(now.getTime() + body.days * DAY_MS) : null;
    const id = uuidv7();
    await tx.insert(userSanctions).values({
      id,
      userId,
      kind: body.kind,
      reason: body.reason,
      until,
      createdByUserId: adminId,
      moderationItemId: opts.moderationItemId ?? null,
    });
    if (body.kind === 'suspend' || body.kind === 'ban') {
      // A ban outranks a suspension; never downgrade a banned account to suspended.
      if (body.kind === 'ban' || user.status !== 'banned')
        await this.users.setStatus(userId, body.kind === 'ban' ? 'banned' : 'suspended', tx);
      await this.sessions.revokeAll(userId, body.kind, tx);
    }
    await this.audit.record(
      {
        adminUserId: adminId,
        action: `users.${body.kind}`,
        targetType: 'user',
        targetId: userId,
        details: {
          sanctionId: id,
          reason: body.reason,
          until: until?.toISOString() ?? null,
          moderationItemId: opts.moderationItemId ?? null,
        },
      },
      tx,
    );
    if (body.kind === 'warn') return () => this.notify(userId, 'warn', { reason: body.reason });
    if (body.kind === 'mute' && until) return () => this.notify(userId, 'mute', { until });
    return undefined;
  }

  /** Ends a mute or suspension early, or lifts a ban. */
  async lift(adminId: string, sanctionId: string, now: Date = new Date()): Promise<string> {
    return this.db.transaction(async (tx) => {
      const [s] = await tx
        .select()
        .from(userSanctions)
        .where(eq(userSanctions.id, sanctionId))
        .for('update');
      if (!s) throw AppError.notFound('Sanction');
      if (s.kind === 'warn' || s.liftedAt || (s.until && s.until.getTime() <= now.getTime()))
        throw new AppError('CONFLICT', 'Nothing to lift', { reason: 'ALREADY_RESOLVED' });
      await tx
        .update(userSanctions)
        .set({ liftedAt: now, liftedByUserId: adminId })
        .where(eq(userSanctions.id, sanctionId));
      await this.restoreIfClear(s.userId, tx, now);
      await this.audit.record(
        {
          adminUserId: adminId,
          action: 'users.lift_sanction',
          targetType: 'user',
          targetId: s.userId,
          details: { sanctionId, kind: s.kind },
        },
        tx,
      );
      return s.userId;
    });
  }

  /** Worker: mutes and suspensions whose time is up end by themselves. */
  async liftExpired(now: Date = new Date()): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(userSanctions)
        .set({ liftedAt: now })
        .where(
          and(
            isNull(userSanctions.liftedAt),
            isNotNull(userSanctions.until),
            lte(userSanctions.until, now),
          ),
        )
        .returning({ userId: userSanctions.userId, kind: userSanctions.kind });
      const suspended = [...new Set(rows.filter((r) => r.kind === 'suspend').map((r) => r.userId))];
      for (const userId of suspended) await this.restoreIfClear(userId, tx, now);
      return rows.length;
    });
  }

  /** Back to active once no ban or running suspension remains. */
  private async restoreIfClear(userId: string, tx: Tx, now: Date): Promise<void> {
    const user = await this.users.findById(userId, tx);
    if (!user || (user.status !== 'suspended' && user.status !== 'banned')) return;
    const blocking = await tx
      .select({ id: userSanctions.id })
      .from(userSanctions)
      .where(
        and(
          eq(userSanctions.userId, userId),
          isNull(userSanctions.liftedAt),
          or(
            eq(userSanctions.kind, 'ban'),
            and(eq(userSanctions.kind, 'suspend'), gt(userSanctions.until, now)),
          ),
        ),
      );
    if (blocking.length === 0) await this.users.setStatus(userId, 'active', tx);
  }

  async history(userId: string): Promise<UserSanction[]> {
    const rows = await this.db
      .select()
      .from(userSanctions)
      .where(eq(userSanctions.userId, userId))
      .orderBy(desc(userSanctions.createdAt))
      .limit(100);
    const adminIds = [
      ...new Set(rows.flatMap((r) => (r.createdByUserId ? [r.createdByUserId] : []))),
    ];
    const names = await this.profiles.displayNames(adminIds);
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      reason: r.reason,
      until: r.until?.toISOString() ?? null,
      liftedAt: r.liftedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      byName: r.createdByUserId ? (names.get(r.createdByUserId) ?? null) : null,
    }));
  }

  /** Current mute / suspension ends, for the admin user page. */
  async activeUntil(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ mutedUntil: Date | null; suspendedUntil: Date | null }> {
    const rows = await this.db
      .select({ kind: userSanctions.kind, until: userSanctions.until })
      .from(userSanctions)
      .where(
        and(
          eq(userSanctions.userId, userId),
          isNull(userSanctions.liftedAt),
          inArray(userSanctions.kind, ['mute', 'suspend']),
        ),
      );
    const latest = (kind: 'mute' | 'suspend'): Date | null =>
      rows
        .filter((r) => r.kind === kind && r.until && r.until.getTime() > now.getTime())
        .map((r) => r.until as Date)
        .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return { mutedUntil: latest('mute'), suspendedUntil: latest('suspend') };
  }

  /** Tells the owner their content was taken down (no detail: the reviewer's note stays internal). */
  async notifyRemoved(userId: string): Promise<void> {
    await this.notify(userId, 'removed', {});
  }

  private async notify(
    userId: string,
    kind: 'warn' | 'mute' | 'removed',
    vars: { reason?: string; until?: Date },
  ): Promise<void> {
    try {
      if (kind === 'warn')
        await this.notifications.notify([userId], 'sanction_warn', { reason: vars.reason ?? '' });
      else if (kind === 'mute')
        await this.notifications.notify([userId], 'sanction_mute', {
          until: vars.until ? { at: vars.until.toISOString() } : '',
        });
      else await this.notifications.notify([userId], 'content_removed', {});
    } catch (err) {
      // The decision stands even if the notice can't be delivered.
      this.logger.warn(
        `Sanction notice failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
