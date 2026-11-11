import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  type LaunchWaitlistBody,
  type LaunchWaitlistEntry,
  type LaunchWaitlistInviteResult,
  type LaunchWaitlistQuery,
  LIMITS,
  type Paginated,
  TimeIdCursor,
} from '@touchgrass/shared';
import { and, desc, eq, isNull, lt, or, type SQL, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { EmailSender } from '../../adapters/email/email.port.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { launchWaitlist } from '../../infra/database/schema/index.js';
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
  ) {}

  /** Adds or updates an entry. Callers learn nothing about whether the contact was already listed. */
  async submit(body: LaunchWaitlistBody): Promise<void> {
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
    const codes = await this.invites.codesByIds(
      page.flatMap((r) => (r.inviteCodeId ? [r.inviteCodeId] : [])),
    );
    const last = page[page.length - 1];
    return {
      items: page.map((r) =>
        toEntry(r, r.inviteCodeId ? (codes.get(r.inviteCodeId) ?? null) : null),
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
        this.logger.warn(`Waitlist invite email for ${row.id} failed: ${String(err)}`);
      }
    }
    return { entry: toEntry(row, code), code, emailed };
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

function toEntry(r: Row, code: string | null): LaunchWaitlistEntry {
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
  };
}
