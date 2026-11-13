import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  type LaunchWaitlistBody,
  type LaunchWaitlistEntry,
  type LaunchWaitlistInviteResult,
  type LaunchWaitlistQuery,
  type WaitlistInsights,
  type WaitlistInsightsQuery,
  LIMITS,
  type Paginated,
  TimeIdCursor,
} from '@touchgrass/shared';
import { and, desc, eq, gte, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { UpstreamError } from '../../adapters/http/http-client.js';
import { EmailSender } from '../../adapters/email/email.port.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { launchWaitlist } from '../../infra/database/schema/index.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { UsersService } from '../users/users.service.js';
import { ReferralCodesService } from '../referrals/referral-codes.service.js';
import { InvitesService } from '../invites/invites.service.js';
import { waitlistInviteEmail } from './waitlist-email.js';

type Row = typeof launchWaitlist.$inferSelect;

export interface ExistingContact {
  id: string;
  phoneE164: string | null;
  email: string | null;
}

export type WaitlistWritePlan =
  { kind: 'insert' } | { kind: 'update'; id: string; setPhone: boolean; setEmail: boolean };

/**
 * Which row a submission updates (pure, unit tested). The row matched by phone wins, else the one matched by
 * email. A contact is only ever filled in where the row has none and no other row holds it: a re-submission
 * can never take over or overwrite somebody's phone or email.
 */
export function planWaitlistWrite(
  input: { phone: string | null; email: string | null },
  byPhone: ExistingContact | null,
  byEmail: ExistingContact | null,
): WaitlistWritePlan {
  const target = byPhone ?? byEmail;
  if (!target) return { kind: 'insert' };
  return {
    kind: 'update',
    id: target.id,
    setPhone: input.phone !== null && byPhone === null && target.phoneE164 === null,
    setEmail: input.email !== null && byEmail === null && target.email === null,
  };
}

const INVITE_LABEL = 'waitlist';

/** Public launch waitlist (D-169): people without an invite ask for one; admins invite or remove them. */
@Injectable()
export class WaitlistService {
  private readonly logger = new Logger(WaitlistService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly invites: InvitesService,
    private readonly audit: AuditService,
    private readonly email: EmailSender,
    private readonly referralCodes: ReferralCodesService,
    private readonly profiles: ProfilesService,
    private readonly users: UsersService,
  ) {}

  /** Adds or updates an entry. Callers learn nothing about whether the contact was already listed. */
  async submit(body: LaunchWaitlistBody): Promise<void> {
    // A friend's referral link (D-191). Unknown or inactive codes are ignored, never an error.
    const referrer = body.ref ? await this.referralCodes.referrerFor(body.ref) : null;
    await this.db.transaction(async (tx) => {
      // Serialise writes so two submissions with overlapping contacts can't race into a unique violation.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('launch_waitlist'))`);
      const find = async (where: SQL): Promise<ExistingContact | null> => {
        const [row] = await tx
          .select({
            id: launchWaitlist.id,
            phoneE164: launchWaitlist.phoneE164,
            email: launchWaitlist.email,
          })
          .from(launchWaitlist)
          .where(where)
          .limit(1);
        return row ?? null;
      };
      const byPhone = body.phone ? await find(eq(launchWaitlist.phoneE164, body.phone)) : null;
      const byEmail = body.email ? await find(eq(launchWaitlist.email, body.email)) : null;
      const plan = planWaitlistWrite(body, byPhone, byEmail);
      if (plan.kind === 'insert') {
        await tx.insert(launchWaitlist).values({
          id: uuidv7(),
          name: body.name,
          phoneE164: body.phone,
          email: body.email,
          city: body.city,
          note: body.note,
          language: body.language,
          source: body.source ?? (referrer ? 'referral' : null),
          referrerUserId: referrer,
        });
        return;
      }
      await tx
        .update(launchWaitlist)
        .set({
          name: body.name,
          city: body.city,
          language: body.language,
          ...(body.note !== null ? { note: body.note } : {}),
          ...(plan.setPhone ? { phoneE164: body.phone } : {}),
          ...(plan.setEmail ? { email: body.email } : {}),
        })
        .where(eq(launchWaitlist.id, plan.id));
    });
  }

  /**
   * Waitlist insights (D-191): totals, sign-ups and invites per IST day, breakdowns by city, language,
   * source, contact and referrer, and how far the period's sign-ups got (invited, joined the app with their
   * code, finished their profile).
   */
  async insights(q: WaitlistInsightsQuery, now: Date = new Date()): Promise<WaitlistInsights> {
    const since = new Date(now.getTime() - q.days * 86_400_000);
    const ist = sql`(timezone('Asia/Kolkata', ${launchWaitlist.createdAt}))::date`;
    const inPeriod = gte(launchWaitlist.createdAt, since);
    const count = sql<number>`count(*)::int`;
    const group = async (key: SQL<string>): Promise<{ key: string; count: number }[]> =>
      (
        await this.db
          .select({ key, count })
          .from(launchWaitlist)
          .where(inPeriod)
          .groupBy(key)
          .orderBy(desc(count))
          .limit(20)
      ).map((r) => ({ key: r.key, count: r.count }));
    const [totals] = await this.db
      .select({
        allTime: count,
        inPeriod: sql<number>`count(*) FILTER (WHERE ${launchWaitlist.createdAt} >= ${since})::int`,
        today: sql<number>`count(*) FILTER (WHERE ${ist} = (timezone('Asia/Kolkata', ${now}::timestamptz))::date)::int`,
        last7Days: sql<number>`count(*) FILTER (WHERE ${launchWaitlist.createdAt} >= ${new Date(now.getTime() - 7 * 86_400_000)})::int`,
        waiting: sql<number>`count(*) FILTER (WHERE ${launchWaitlist.invitedAt} IS NULL)::int`,
      })
      .from(launchWaitlist);
    const dailyRows = await this.db.execute<{
      day: string;
      signed_up: number;
      invited: number;
    }>(sql`
      SELECT d::date::text AS day,
        (SELECT count(*)::int FROM launch_waitlist w
          WHERE (timezone('Asia/Kolkata', w.created_at))::date = d::date) AS signed_up,
        (SELECT count(*)::int FROM launch_waitlist w
          WHERE w.invited_at IS NOT NULL AND (timezone('Asia/Kolkata', w.invited_at))::date = d::date) AS invited
      FROM generate_series(
        (timezone('Asia/Kolkata', ${since}::timestamptz))::date + 1,
        (timezone('Asia/Kolkata', ${now}::timestamptz))::date,
        interval '1 day') AS d
      ORDER BY d`);
    const [byCity, byLanguage, bySource, byContact, referrerRows, cohort] = await Promise.all([
      group(sql<string>`${launchWaitlist.city}`),
      group(sql<string>`${launchWaitlist.language}`),
      group(sql<string>`coalesce(${launchWaitlist.source}, 'unknown')`),
      group(
        sql<string>`CASE WHEN ${launchWaitlist.phoneE164} IS NOT NULL AND ${launchWaitlist.email} IS NOT NULL THEN 'both' WHEN ${launchWaitlist.phoneE164} IS NOT NULL THEN 'phone' ELSE 'email' END`,
      ),
      this.db
        .select({ id: launchWaitlist.referrerUserId, count })
        .from(launchWaitlist)
        .where(and(inPeriod, isNotNull(launchWaitlist.referrerUserId)))
        .groupBy(launchWaitlist.referrerUserId)
        .orderBy(desc(count))
        .limit(20),
      this.db
        .select({ invitedAt: launchWaitlist.invitedAt, codeId: launchWaitlist.inviteCodeId })
        .from(launchWaitlist)
        .where(inPeriod),
    ]);
    const referrerIds = referrerRows.flatMap((r) => (r.id ? [r.id] : []));
    const codeIds = cohort.flatMap((r) => (r.codeId ? [r.codeId] : []));
    const [names, redemptions] = await Promise.all([
      this.profiles.displayNames(referrerIds),
      this.invites.redemptionsByCodeIds(codeIds),
    ]);
    const joinedIds = [...redemptions.values()].map((r) => r.userId);
    const finished = await this.users.activeIds(joinedIds);
    return {
      days: q.days,
      totals: totals ?? { allTime: 0, inPeriod: 0, today: 0, last7Days: 0, waiting: 0 },
      daily: dailyRows.rows.map((r) => ({
        day: r.day,
        signedUp: r.signed_up,
        invited: r.invited,
      })),
      byCity,
      byLanguage,
      bySource,
      byContact,
      byReferrer: referrerRows.flatMap((r) =>
        r.id ? [{ id: r.id, name: names.get(r.id) ?? 'Member', count: r.count }] : [],
      ),
      funnel: {
        signedUp: cohort.length,
        invited: cohort.filter((r) => r.invitedAt !== null).length,
        joinedApp: joinedIds.length,
        finishedProfile: finished.size,
      },
    };
  }

  async list(q: LaunchWaitlistQuery): Promise<Paginated<LaunchWaitlistEntry>> {
    const after = q.cursor ? decodeCursor(q.cursor, TimeIdCursor) : null;
    const rows = await this.db
      .select()
      .from(launchWaitlist)
      .where(
        and(
          q.status === 'waiting' ? isNull(launchWaitlist.invitedAt) : undefined,
          after
            ? or(
                lt(launchWaitlist.createdAt, new Date(after.t)),
                and(
                  eq(launchWaitlist.createdAt, new Date(after.t)),
                  lt(launchWaitlist.id, after.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(desc(launchWaitlist.createdAt), desc(launchWaitlist.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const [codes, names] = await Promise.all([
      this.invites.codesByIds(page.flatMap((r) => (r.inviteCodeId ? [r.inviteCodeId] : []))),
      this.profiles.displayNames([
        ...new Set(page.flatMap((r) => (r.referrerUserId ? [r.referrerUserId] : []))),
      ]),
    ]);
    const last = page[page.length - 1];
    return {
      items: page.map((r) =>
        toEntry(r, r.inviteCodeId ? (codes.get(r.inviteCodeId) ?? null) : null, names),
      ),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  /**
   * Creates a single-use code for the entry, marks it invited and audits it, all in one transaction; then
   * emails the code when the entry has an address. Email is best effort: the admin always gets the code.
   */
  async invite(adminUserId: string, id: string): Promise<LaunchWaitlistInviteResult> {
    const validDays = LIMITS.invites.defaultExpiryDays;
    const { row, code } = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(launchWaitlist)
        .where(eq(launchWaitlist.id, id))
        .for('update');
      if (!current) throw AppError.notFound('Waitlist entry');
      if (current.invitedAt)
        throw AppError.conflict('Already invited', { reason: 'ALREADY_INVITED' });
      const [invite] = await this.invites.createBulk(
        adminUserId,
        {
          count: 1,
          maxUses: 1,
          expiresAt: new Date(Date.now() + validDays * 86_400_000).toISOString(),
          label: INVITE_LABEL,
        },
        tx,
      );
      if (!invite) throw new Error('No invite code was created');
      const [updated] = await tx
        .update(launchWaitlist)
        .set({ invitedAt: new Date(), inviteCodeId: invite.id })
        .where(eq(launchWaitlist.id, id))
        .returning();
      if (!updated) throw AppError.notFound('Waitlist entry');
      await this.audit.record(
        {
          adminUserId,
          action: 'waitlist.invite',
          targetType: 'launch_waitlist',
          targetId: id,
          details: { inviteCodeId: invite.id, code: invite.code, city: updated.city },
        },
        tx,
      );
      return { row: updated, code: invite.code };
    });
    let emailed = false;
    let emailError: string | null = null;
    if (row.email) {
      try {
        await this.email.send(
          waitlistInviteEmail({
            to: row.email,
            name: row.name,
            code,
            validDays,
            siteUrl: this.env.WEB_PUBLIC_URL,
            language: row.language,
          }),
        );
        emailed = true;
      } catch (err) {
        // The mail service's own answer (e.g. an unrecognised server address), so the admin can fix it.
        emailError = (
          err instanceof UpstreamError
            ? `${err.message}: ${err.upstreamBody}`
            : err instanceof Error
              ? err.message
              : String(err)
        ).slice(0, 300);
        this.logger.warn(`Waitlist invite email for ${row.id} failed: ${emailError}`);
      }
    }
    return { entry: toEntry(row, code), code, emailed, emailError };
  }

  /** Data-deletion requests and clean-up: the entry is deleted, not hidden. */
  async remove(adminUserId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [gone] = await tx
        .delete(launchWaitlist)
        .where(eq(launchWaitlist.id, id))
        .returning({ id: launchWaitlist.id, invitedAt: launchWaitlist.invitedAt });
      if (!gone) throw AppError.notFound('Waitlist entry');
      await this.audit.record(
        {
          adminUserId,
          action: 'waitlist.remove',
          targetType: 'launch_waitlist',
          targetId: id,
          details: { wasInvited: gone.invitedAt !== null },
        },
        tx,
      );
    });
  }
}

function toEntry(
  r: Row,
  code: string | null,
  names: Map<string, string> = new Map(),
): LaunchWaitlistEntry {
  return {
    id: r.id,
    name: r.name,
    phone: r.phoneE164,
    email: r.email,
    city: r.city,
    note: r.note,
    language: r.language,
    createdAt: r.createdAt.toISOString(),
    invitedAt: r.invitedAt?.toISOString() ?? null,
    inviteCode: code,
    source: r.source,
    referrer: r.referrerUserId
      ? { id: r.referrerUserId, name: names.get(r.referrerUserId) ?? 'Member' }
      : null,
  };
}
