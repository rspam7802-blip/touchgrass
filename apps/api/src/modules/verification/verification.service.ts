import { randomInt } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AdminVerification,
  type AdminVerificationList,
  decodeCursor,
  encodeCursor,
  LIMITS,
  type MyVerification,
  type ReviewVerificationBody,
  type SubmitVerificationBody,
  TimeIdCursor,
  VERIFICATION_POSES,
  type VerificationPose,
  zonedParts,
} from '@touchgrass/shared';
import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { ModerationProvider } from '../../adapters/moderation/moderation.port.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { verifications } from '../../infra/database/schema/index.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { MediaService } from '../media/media.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { UsersService } from '../users/users.service.js';

const V = LIMITS.verification;
type Row = typeof verifications.$inferSelect;

function denied(reason: string, message: string): AppError {
  return new AppError('NOT_ELIGIBLE', message, { reason });
}

/** Midnight IST that starts `now`'s day: the daily attempt budget resets then. */
export function istDayStart(now: Date): Date {
  const p = zonedParts(now);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - (5 * 60 + 30) * 60_000);
}

/**
 * Verified profiles (F-SAF-01). A person asks for a random pose, takes a selfie copying it, and a reviewer
 * compares it with their profile photos (helped by an optional automatic face match). The selfie is deleted
 * once reviewed. Approval sets the badge that hosting, women-only plans and gender balance rely on.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly media: MediaService,
    private readonly faces: ModerationProvider,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private async latest(userId: string): Promise<Row | null> {
    const [row] = await this.db
      .select()
      .from(verifications)
      .where(eq(verifications.userId, userId))
      .orderBy(desc(verifications.createdAt))
      .limit(1);
    return row ?? null;
  }

  private async attemptsToday(
    userId: string,
    now: Date,
    db: Database | Tx = this.db,
  ): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(verifications)
      .where(and(eq(verifications.userId, userId), gte(verifications.createdAt, istDayStart(now))));
    return row?.n ?? 0;
  }

  async mine(userId: string, now: Date = new Date()): Promise<MyVerification> {
    const [user, last, used] = await Promise.all([
      this.users.findById(userId),
      this.latest(userId),
      this.attemptsToday(userId, now),
    ]);
    if (!user) throw AppError.notFound('Account');
    const verified = user.verifiedAt !== null;
    const open =
      last?.status === 'challenged' && last.expiresAt.getTime() > now.getTime() ? last : null;
    const status = verified
      ? 'approved'
      : last?.status === 'pending'
        ? 'pending'
        : last?.status === 'rejected'
          ? 'rejected'
          : 'none';
    return {
      status,
      verified,
      challenge: open
        ? {
            id: open.id,
            pose: open.pose as VerificationPose,
            expiresAt: open.expiresAt.toISOString(),
          }
        : null,
      submittedAt: last?.submittedAt?.toISOString() ?? null,
      rejectReason: status === 'rejected' ? (last?.rejectReason ?? null) : null,
      attemptsLeftToday: Math.max(0, V.maxAttemptsPerDay - used),
    };
  }

  /** A fresh random pose (or the one already open). Each new pose uses one of the day's attempts. */
  async start(userId: string, now: Date = new Date()): Promise<MyVerification> {
    const user = await this.users.findById(userId);
    if (!user) throw AppError.notFound('Account');
    if (user.verifiedAt) throw denied('ALREADY_VERIFIED', 'Already verified');
    const photos = await this.profiles.photos(userId, true);
    if (!photos.some((p) => p.status === 'ready'))
      throw denied('NEEDS_PROFILE_PHOTO', 'Add a profile photo first');
    await this.db.transaction(async (tx) => {
      // One open attempt per person (unique index); serialise starts so the daily budget holds.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`verify:${userId}`}))`);
      const open = await tx
        .select()
        .from(verifications)
        .where(
          and(
            eq(verifications.userId, userId),
            inArray(verifications.status, ['challenged', 'pending']),
          ),
        );
      const current = open[0];
      if (current?.status === 'pending') throw denied('VERIFICATION_PENDING', 'Already in review');
      if (current && current.expiresAt.getTime() > now.getTime()) return;
      if (current)
        await tx
          .update(verifications)
          .set({ status: 'expired' })
          .where(eq(verifications.id, current.id));
      if ((await this.attemptsToday(userId, now, tx)) >= V.maxAttemptsPerDay)
        throw denied('NO_ATTEMPTS_LEFT', 'No attempts left today');
      const pose = VERIFICATION_POSES[randomInt(VERIFICATION_POSES.length)] as VerificationPose;
      await tx.insert(verifications).values({
        id: uuidv7(),
        userId,
        pose,
        expiresAt: new Date(now.getTime() + V.challengeTtlMs),
      });
    });
    return this.mine(userId, now);
  }

  async submit(
    userId: string,
    body: SubmitVerificationBody,
    now: Date = new Date(),
  ): Promise<MyVerification> {
    const [challenge] = await this.db
      .select()
      .from(verifications)
      .where(and(eq(verifications.id, body.challengeId), eq(verifications.userId, userId)));
    if (!challenge) throw AppError.notFound('Verification');
    if (challenge.status === 'pending') throw denied('VERIFICATION_PENDING', 'Already in review');
    if (challenge.status !== 'challenged' || challenge.expiresAt.getTime() <= now.getTime()) {
      if (challenge.status === 'challenged')
        await this.db
          .update(verifications)
          .set({ status: 'expired' })
          .where(eq(verifications.id, challenge.id));
      throw denied('CHALLENGE_EXPIRED', 'That pose expired');
    }
    const selfie = await this.media.ownedOrThrow(userId, body.mediaId);
    if (selfie.purpose !== 'verification_selfie')
      throw new AppError('VALIDATION_FAILED', 'Upload a verification selfie', [
        { path: 'mediaId', message: 'Wrong purpose', code: 'custom' },
      ]);
    if (selfie.status !== 'ready')
      throw new AppError('MEDIA_NOT_READY', 'Selfie is still processing');
    const similarity = await this.compare(userId, selfie.variantKeys);
    const updated = await this.db
      .update(verifications)
      .set({
        status: 'pending',
        mediaAssetId: selfie.id,
        faceSimilarity: similarity,
        submittedAt: now,
      })
      .where(and(eq(verifications.id, challenge.id), eq(verifications.status, 'challenged')))
      .returning({ id: verifications.id });
    if (updated.length === 0) throw denied('VERIFICATION_PENDING', 'Already in review');
    return this.mine(userId, now);
  }

  /** Optional automatic help for reviewers: best match of the selfie against any ready profile photo. */
  private async compare(
    userId: string,
    selfieKeys: Parameters<MediaService['readVariant']>[0] | null,
  ): Promise<number | null> {
    if (!selfieKeys) return null;
    try {
      const photos = (await this.profiles.photos(userId, true)).filter((p) => p.status === 'ready');
      const assets = await this.media.byIds(photos.map((p) => p.mediaAssetId));
      const source = await this.media.readVariant(selfieKeys, 'md');
      let best: number | null = null;
      for (const a of assets) {
        if (!a.variantKeys) continue;
        const score = await this.faces.compareFaces(
          source,
          await this.media.readVariant(a.variantKeys, 'md'),
        );
        if (score !== null && (best === null || score > best)) best = score;
      }
      return best === null ? null : Math.round(best * 10) / 10;
    } catch (err) {
      // Face matching only assists the reviewer; it must never block a submission.
      this.logger.warn(
        `Face comparison failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  // ---------- review (admin) ----------

  async queue(cursor: string | undefined, limit: number): Promise<AdminVerificationList> {
    const after = cursor ? decodeCursor(cursor, TimeIdCursor) : null;
    const rows = await this.db
      .select()
      .from(verifications)
      .where(
        and(
          eq(verifications.status, 'pending'),
          after
            ? sql`(${verifications.submittedAt}, ${verifications.id}) > (${new Date(after.t)}, ${after.id}::uuid)`
            : sql`true`,
        ),
      )
      .orderBy(asc(verifications.submittedAt), asc(verifications.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const items = await Promise.all(page.map((r) => this.adminView(r)));
    const last = page.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last?.submittedAt
          ? encodeCursor({ t: last.submittedAt.toISOString(), id: last.id })
          : null,
    };
  }

  private async adminView(r: Row): Promise<AdminVerification> {
    const [names, gender, selfie, photos] = await Promise.all([
      this.profiles.displayNames([r.userId]),
      this.profiles.genderOf(r.userId),
      r.mediaAssetId ? this.media.byId(r.mediaAssetId) : Promise.resolve(null),
      this.profiles.photos(r.userId, true),
    ]);
    return {
      id: r.id,
      user: { id: r.userId, displayName: names.get(r.userId) ?? '', gender },
      pose: r.pose as VerificationPose,
      selfie: selfie ? await this.media.urlsFor(selfie.variantKeys) : null,
      profilePhotos: photos.flatMap((p) => (p.urls ? [p.urls] : [])),
      faceSimilarity: r.faceSimilarity,
      submittedAt: (r.submittedAt ?? r.createdAt).toISOString(),
    };
  }

  async review(
    adminId: string,
    id: string,
    body: ReviewVerificationBody,
    now: Date = new Date(),
  ): Promise<AdminVerification> {
    const reviewed = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(verifications)
        .where(eq(verifications.id, id))
        .for('update');
      if (!row) throw AppError.notFound('Verification');
      if (row.status !== 'pending')
        throw new AppError('CONFLICT', 'Already reviewed', { reason: 'ALREADY_RESOLVED' });
      const [done] = await tx
        .update(verifications)
        .set({
          status: body.decision,
          rejectReason: body.decision === 'rejected' ? body.reason : null,
          reviewedByUserId: adminId,
          reviewedAt: now,
        })
        .where(eq(verifications.id, id))
        .returning();
      if (body.decision === 'approved') await this.users.setVerifiedAt(row.userId, now, tx);
      await this.audit.record(
        {
          adminUserId: adminId,
          action: `verification.${body.decision === 'approved' ? 'approve' : 'reject'}`,
          targetType: 'user',
          targetId: row.userId,
          details: { verificationId: id, reason: body.reason, faceSimilarity: row.faceSimilarity },
        },
        tx,
      );
      return done ?? row;
    });
    const view = await this.adminView(reviewed);
    // Data minimisation: the selfie served its purpose.
    if (reviewed.mediaAssetId) {
      await this.media.destroy([reviewed.mediaAssetId]);
      await this.db
        .update(verifications)
        .set({ mediaAssetId: null })
        .where(eq(verifications.id, id));
    }
    await this.notify(reviewed);
    return { ...view, selfie: null };
  }

  private async notify(row: Row): Promise<void> {
    try {
      if (row.status === 'approved')
        await this.notifications.notify([row.userId], 'verification_approved', {});
      else
        await this.notifications.notify([row.userId], 'verification_rejected', {
          reason: { t: `verification.rejectReasons.${row.rejectReason ?? 'OTHER'}` },
        });
    } catch (err) {
      this.logger.warn(
        `Verification notice failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select({
        pose: verifications.pose,
        status: verifications.status,
        submittedAt: verifications.submittedAt,
        reviewedAt: verifications.reviewedAt,
        rejectReason: verifications.rejectReason,
        createdAt: verifications.createdAt,
      })
      .from(verifications)
      .where(eq(verifications.userId, userId))
      .orderBy(asc(verifications.createdAt));
    return { verifications: rows };
  }

  /** Erases attempts; returns selfies still stored so they can be deleted once the erase commits. */
  async eraseFor(userId: string, tx: Tx): Promise<string[]> {
    const rows = await tx
      .delete(verifications)
      .where(eq(verifications.userId, userId))
      .returning({ mediaAssetId: verifications.mediaAssetId });
    return rows.flatMap((r) => (r.mediaAssetId ? [r.mediaAssetId] : []));
  }
}
