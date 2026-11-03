import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminHostApplication,
  type AdminHostApplicationQuery,
  type CreateHostApplicationBody,
  decodeCursor,
  encodeCursor,
  type HostApplication,
  type HostStatus,
  LIMITS,
  type ReviewHostApplicationBody,
  TimeIdCursor,
} from '@touchgrass/shared';
import { and, asc, desc, eq, gt, inArray, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { type CityScope, inScope } from '../../common/auth/admin-scope.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { hostApplications } from '../../infra/database/schema/index.js';
import { PayoutsService } from '../payments/payouts.service.js';
import { AppSettingsService } from '../platform/app-settings.service.js';
import { FeatureFlagsService } from '../platform/feature-flags.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { UsersService } from '../users/users.service.js';

type ApplicationRow = typeof hostApplications.$inferSelect;

function toApplication(a: ApplicationRow): HostApplication {
  return {
    id: a.id,
    status: a.status,
    about: a.about,
    experience: a.experience,
    eventIdeas: a.eventIdeas,
    links: a.links,
    reviewNote: a.reviewNote,
    createdAt: a.createdAt.toISOString(),
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
  };
}

/** Pure rule (F-HST-01): free plans need a verified profile (when the flag asks for it); paid plans also need an approved application. */
export function hostingRights(
  verified: boolean,
  verificationRequired: boolean,
  application: { status: string } | null,
): { canHostFree: boolean; canHostPaid: boolean } {
  const canHostFree = verified || !verificationRequired;
  return { canHostFree, canHostPaid: canHostFree && application?.status === 'approved' };
}

/** Open hosting and host applications (F-HST-01). */
@Injectable()
export class HostingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly users: UsersService,
    private readonly flags: FeatureFlagsService,
    private readonly settings: AppSettingsService,
    private readonly payouts: PayoutsService,
    private readonly people: PeopleService,
  ) {}

  /** Latest application: the live one (pending/approved) if any, else the most recent rejection. */
  private async latest(userId: string): Promise<ApplicationRow | null> {
    const [a] = await this.db
      .select()
      .from(hostApplications)
      .where(eq(hostApplications.userId, userId))
      .orderBy(desc(hostApplications.createdAt))
      .limit(1);
    return a ?? null;
  }

  async status(userId: string): Promise<HostStatus> {
    const [application, verified, required, account, feeBps] = await Promise.all([
      this.latest(userId),
      this.users.verifiedIds([userId]),
      this.flags.isEnabled('require_verification_to_host'),
      this.payouts.account(userId),
      this.settings.get('platform_fee_bps'),
    ]);
    const rights = hostingRights(verified.has(userId), required, application);
    return {
      ...rights,
      application: application ? toApplication(application) : null,
      account,
      platformFeeBps: feeBps,
      gstBps: LIMITS.payments.gstBps,
    };
  }

  async canHostPaid(userId: string): Promise<boolean> {
    return (await this.status(userId)).canHostPaid;
  }

  async apply(userId: string, body: CreateHostApplicationBody): Promise<HostApplication> {
    const status = await this.status(userId);
    if (!status.canHostFree)
      throw new AppError('VERIFICATION_REQUIRED', 'Verify your profile to host');
    if (status.application && status.application.status !== 'rejected')
      throw new AppError('CONFLICT', 'You already have an application', {
        status: status.application.status,
      });
    const [row] = await this.db
      .insert(hostApplications)
      .values({ id: uuidv7(), userId, status: 'pending', ...body })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new AppError('CONFLICT', 'You already have an application');
    return toApplication(row);
  }

  // ---------- admin ----------

  /** The applicant's home city (curators review only their cities' applications, D-118). */
  async applicantCity(applicationId: string): Promise<string | null | undefined> {
    const [row] = await this.db
      .select({ userId: hostApplications.userId })
      .from(hostApplications)
      .where(eq(hostApplications.id, applicationId))
      .limit(1);
    if (!row) return undefined;
    return (await this.users.findById(row.userId))?.cityId ?? null;
  }

  async adminList(
    adminId: string,
    q: AdminHostApplicationQuery,
    scope: CityScope = 'all',
  ): Promise<{ items: AdminHostApplication[]; nextCursor: string | null }> {
    const after = q.cursor ? decodeCursor(q.cursor, TimeIdCursor) : null;
    const rows = await this.db
      .select()
      .from(hostApplications)
      .where(
        and(
          eq(hostApplications.status, q.status),
          after
            ? or(
                gt(hostApplications.createdAt, new Date(after.t)),
                and(
                  eq(hostApplications.createdAt, new Date(after.t)),
                  gt(hostApplications.id, after.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(hostApplications.createdAt), asc(hostApplications.id))
      .limit(q.limit + 1);
    const scanned = rows.slice(0, q.limit);
    // Applications carry no city: a curator's page keeps those whose applicant lives in their cities.
    const homes =
      scope === 'all'
        ? null
        : new Map(
            (await this.users.byIds(scanned.map((r) => r.userId))).map((u) => [u.id, u.cityId]),
          );
    const page = homes
      ? scanned.filter((r) => inScope(scope, homes.get(r.userId) ?? null))
      : scanned;
    const cards = await this.people.cards(
      adminId,
      page.map((r) => r.userId),
      { includeSelf: true },
    );
    // The cursor follows what was scanned, so filtered-out rows are not read again.
    const last = scanned[scanned.length - 1];
    return {
      items: page.flatMap((r) => {
        const applicant = cards.get(r.userId);
        return applicant ? [{ ...toApplication(r), applicant }] : [];
      }),
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
    };
  }

  async review(
    adminId: string,
    applicationId: string,
    body: ReviewHostApplicationBody,
    now: Date = new Date(),
  ): Promise<HostApplication> {
    const [row] = await this.db
      .update(hostApplications)
      .set({
        status: body.decision,
        reviewNote: body.note || null,
        reviewedByUserId: adminId,
        reviewedAt: now,
      })
      .where(and(eq(hostApplications.id, applicationId), eq(hostApplications.status, 'pending')))
      .returning();
    if (!row) throw new AppError('CONFLICT', 'Only pending applications can be reviewed');
    return toApplication(row);
  }

  /** Account data. Applications are the person's own words: exported, and deleted on erasure. */
  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select()
      .from(hostApplications)
      .where(eq(hostApplications.userId, userId));
    return { hostApplications: rows.map(toApplication) };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(hostApplications).where(eq(hostApplications.userId, userId));
    await tx
      .update(hostApplications)
      .set({ reviewedByUserId: null })
      .where(inArray(hostApplications.reviewedByUserId, [userId]));
  }
}
