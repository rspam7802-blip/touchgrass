import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  LIMITS,
  type LiveShare,
  type LocationPointBody,
  type PublicLiveView,
  type SosBody,
  type StartShareBody,
  type TrustedContact,
  type TrustedContactBody,
} from '@touchgrass/shared';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { SmsSender, type SmsTemplate } from '../../adapters/sms/sms.port.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import {
  liveLocationPoints,
  liveLocationShares,
  trustedContacts,
} from '../../infra/database/schema/index.js';
import { EventsService } from '../events/events.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FeatureFlagsService } from '../platform/feature-flags.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { UsersService } from '../users/users.service.js';
import { signLiveToken, verifyLiveToken } from './live-link.js';

const S = LIMITS.safety;
const HOUR_MS = 3_600_000;
/** Links keep working (showing "stopped sharing") until the points behind them are purged. */
const LINK_GRACE_MS = S.liveLocationRetentionMs;
/** SOS without a running share starts one for this long, so contacts can follow. */
const SOS_SHARE_MINUTES = 60;

type ShareRow = typeof liveLocationShares.$inferSelect;

function denied(reason: string, message: string): AppError {
  return new AppError('NOT_ELIGIBLE', message, { reason });
}

/**
 * Trusted contacts, live location and SOS (F-SAF-04). Contacts get an SMS with a signed link to a public page
 * (F-WEB-02) showing where the person is and the plan they're at. Shares end by themselves; every point is
 * deleted within 24 hours.
 */
@Injectable()
export class SafetyService {
  private readonly logger = new Logger(SafetyService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly sms: SmsSender,
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly events: EventsService,
    private readonly flags: FeatureFlagsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------- trusted contacts ----------

  async contacts(userId: string): Promise<TrustedContact[]> {
    const rows = await this.db
      .select()
      .from(trustedContacts)
      .where(eq(trustedContacts.userId, userId))
      .orderBy(asc(trustedContacts.createdAt));
    return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phoneE164 }));
  }

  async addContact(userId: string, body: TrustedContactBody): Promise<TrustedContact[]> {
    const me = await this.users.findById(userId);
    if (me?.phoneE164 === body.phone) throw denied('OWN_NUMBER', 'That is your own number');
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`contacts:${userId}`}))`);
      const existing = await tx
        .select({ phone: trustedContacts.phoneE164 })
        .from(trustedContacts)
        .where(eq(trustedContacts.userId, userId));
      if (existing.some((c) => c.phone === body.phone))
        throw denied('DUPLICATE_CONTACT', 'Already a trusted contact');
      if (existing.length >= S.maxTrustedContacts)
        throw denied('CONTACTS_FULL', 'Trusted contacts are full');
      await tx
        .insert(trustedContacts)
        .values({ id: uuidv7(), userId, name: body.name, phoneE164: body.phone });
    });
    return this.contacts(userId);
  }

  async removeContact(userId: string, contactId: string): Promise<TrustedContact[]> {
    const rows = await this.db
      .delete(trustedContacts)
      .where(and(eq(trustedContacts.id, contactId), eq(trustedContacts.userId, userId)))
      .returning({ id: trustedContacts.id });
    if (rows.length === 0) throw AppError.notFound('Contact');
    return this.contacts(userId);
  }

  // ---------- live location ----------

  private link(share: Pick<ShareRow, 'id' | 'expiresAt'>): string {
    const token = signLiveToken(
      share.id,
      new Date(share.expiresAt.getTime() + LINK_GRACE_MS),
      this.env.SIGNED_URL_SECRET,
    );
    return `${this.env.WEB_PUBLIC_URL}/l/${token}`;
  }

  private toDto(share: ShareRow, now: Date): LiveShare {
    return {
      id: share.id,
      eventId: share.eventId,
      startedAt: share.startedAt.toISOString(),
      expiresAt: share.expiresAt.toISOString(),
      endedAt: share.endedAt?.toISOString() ?? null,
      sosAt: share.sosAt?.toISOString() ?? null,
      active: share.endedAt === null && share.expiresAt.getTime() > now.getTime(),
      contactsNotified: share.contactsNotified,
      lastPointAt: share.lastPointAt?.toISOString() ?? null,
      link: this.link(share),
    };
  }

  /** The running share, closing it first if its time is already up. */
  private async active(
    userId: string,
    now: Date,
    db: Database | Tx = this.db,
  ): Promise<ShareRow | null> {
    const [row] = await db
      .select()
      .from(liveLocationShares)
      .where(and(eq(liveLocationShares.userId, userId), isNull(liveLocationShares.endedAt)));
    if (!row) return null;
    if (row.expiresAt.getTime() > now.getTime()) return row;
    await db
      .update(liveLocationShares)
      .set({ endedAt: row.expiresAt })
      .where(and(eq(liveLocationShares.id, row.id), isNull(liveLocationShares.endedAt)));
    return null;
  }

  async mine(userId: string, now: Date = new Date()): Promise<LiveShare | null> {
    const row = await this.active(userId, now);
    return row ? this.toDto(row, now) : null;
  }

  private async assertEnabled(): Promise<void> {
    if (!(await this.flags.isEnabled('live_location')))
      throw new AppError('FEATURE_DISABLED', 'Live location is switched off');
  }

  /** Your own plans can be shared from shortly before they start until a while after they end. */
  private async assertEventWindow(userId: string, eventId: string, now: Date): Promise<void> {
    const event = await this.events.detailFor(userId, eventId);
    const mine =
      event.viewer.isHost || event.viewer.rsvp === 'going' || event.viewer.rsvp === 'checked_in';
    if (!mine) throw denied('NOT_GOING', 'Only plans you are going to');
    const opens = new Date(event.startsAt).getTime() - S.eventWindowBeforeMs;
    const closes = new Date(event.endsAt).getTime() + S.eventWindowAfterMs;
    if (now.getTime() < opens || now.getTime() > closes)
      throw denied('OUTSIDE_EVENT_WINDOW', 'Outside the plan window');
  }

  async start(userId: string, body: StartShareBody, now: Date = new Date()): Promise<LiveShare> {
    await this.assertEnabled();
    const contacts = await this.contacts(userId);
    if (contacts.length === 0) throw denied('NO_CONTACTS', 'Add a trusted contact first');
    if (body.eventId) await this.assertEventWindow(userId, body.eventId, now);
    const share = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`live:${userId}`}))`);
      if (await this.active(userId, now, tx)) throw denied('SHARE_ACTIVE', 'Already sharing');
      const [row] = await tx
        .insert(liveLocationShares)
        .values({
          id: uuidv7(),
          userId,
          eventId: body.eventId,
          startedAt: now,
          expiresAt: new Date(now.getTime() + body.minutes * 60_000),
        })
        .returning();
      if (!row) throw new Error('share insert returned nothing');
      return row;
    });
    const sent = await this.textContacts(userId, share, 'live_location_share');
    const [updated] = await this.db
      .update(liveLocationShares)
      .set({ contactsNotified: sent })
      .where(eq(liveLocationShares.id, share.id))
      .returning();
    return this.toDto(updated ?? share, now);
  }

  /** A fix from the phone while the app is open. */
  async addPoint(
    userId: string,
    body: LocationPointBody,
    now: Date = new Date(),
  ): Promise<LiveShare> {
    const share = await this.active(userId, now);
    if (!share) throw denied('NO_ACTIVE_SHARE', 'Not sharing right now');
    await this.record(share.id, body, now);
    return this.toDto({ ...share, lastPointAt: now }, now);
  }

  private async record(shareId: string, point: LocationPointBody, now: Date): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.insert(liveLocationPoints).values({
        id: uuidv7(),
        shareId,
        lat: point.lat,
        lng: point.lng,
        accuracy: point.accuracy,
        recordedAt: now,
      });
      await tx
        .update(liveLocationShares)
        .set({ lastPointAt: now })
        .where(eq(liveLocationShares.id, shareId));
    });
  }

  async stop(userId: string, now: Date = new Date()): Promise<null> {
    await this.db
      .update(liveLocationShares)
      .set({ endedAt: now })
      .where(and(eq(liveLocationShares.userId, userId), isNull(liveLocationShares.endedAt)));
    return null;
  }

  /**
   * SOS: alerts every trusted contact with a live link (starting a share if none is running). The app calls
   * 112 itself; this never refuses, so a missing contact or a switched-off flag can't stand in the way.
   */
  async sos(userId: string, body: SosBody, now: Date = new Date()): Promise<LiveShare> {
    const share = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`live:${userId}`}))`);
      const running = await this.active(userId, now, tx);
      if (running) {
        const [row] = await tx
          .update(liveLocationShares)
          .set({ sosAt: now })
          .where(eq(liveLocationShares.id, running.id))
          .returning();
        return row ?? running;
      }
      const [row] = await tx
        .insert(liveLocationShares)
        .values({
          id: uuidv7(),
          userId,
          startedAt: now,
          expiresAt: new Date(now.getTime() + SOS_SHARE_MINUTES * 60_000),
          sosAt: now,
        })
        .returning();
      if (!row) throw new Error('share insert returned nothing');
      return row;
    });
    if (body.point) await this.record(share.id, body.point, now);
    const sent = await this.textContacts(userId, share, 'sos_alert');
    const [updated] = await this.db
      .update(liveLocationShares)
      .set({ contactsNotified: sql`greatest(${liveLocationShares.contactsNotified}, ${sent})` })
      .where(eq(liveLocationShares.id, share.id))
      .returning();
    this.logger.warn(`SOS from ${userId}: ${sent} contacts alerted`);
    return this.toDto(updated ?? share, now);
  }

  /** Texts each contact separately; one failed number doesn't stop the others. */
  private async textContacts(
    userId: string,
    share: ShareRow,
    template: SmsTemplate,
  ): Promise<number> {
    const [contacts, names] = await Promise.all([
      this.contacts(userId),
      this.profiles.displayNames([userId]),
    ]);
    const vars = { name: names.get(userId) ?? 'Your friend', url: this.link(share) };
    let sent = 0;
    for (const c of contacts) {
      try {
        await this.sms.sendTemplate(c.phone, template, vars);
        sent += 1;
      } catch (err) {
        this.logger.error(
          `${template} to contact ${c.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return sent;
  }

  // ---------- public viewer (F-WEB-02) ----------

  async publicView(token: string, now: Date = new Date()): Promise<PublicLiveView> {
    const shareId = verifyLiveToken(token, this.env.SIGNED_URL_SECRET, now);
    if (!shareId) throw AppError.notFound('Link');
    const [share] = await this.db
      .select()
      .from(liveLocationShares)
      .where(eq(liveLocationShares.id, shareId));
    if (!share) throw AppError.notFound('Link');
    const active = share.endedAt === null && share.expiresAt.getTime() > now.getTime();
    const user = await this.users.findById(share.userId);
    if (!user || user.status === 'deleted' || user.status === 'deletion_pending')
      throw AppError.notFound('Link');
    const name = (await this.profiles.displayNames([share.userId])).get(share.userId) ?? '';
    const base = {
      name,
      status: active ? ('active' as const) : ('ended' as const),
      sos: share.sosAt !== null,
      startedAt: share.startedAt.toISOString(),
      expiresAt: (share.endedAt ?? share.expiresAt).toISOString(),
    };
    // Once sharing ends the link says so, and shows nothing more.
    if (!active) return { ...base, lastPoint: null, trail: [], event: null };
    const points = await this.db
      .select()
      .from(liveLocationPoints)
      .where(eq(liveLocationPoints.shareId, share.id))
      .orderBy(desc(liveLocationPoints.recordedAt))
      .limit(S.trailPoints);
    const last = points[0];
    return {
      ...base,
      lastPoint: last
        ? {
            lat: last.lat,
            lng: last.lng,
            accuracy: last.accuracy,
            at: last.recordedAt.toISOString(),
          }
        : null,
      trail: [...points]
        .reverse()
        .map((p) => ({ lat: p.lat, lng: p.lng, at: p.recordedAt.toISOString() })),
      event: share.eventId ? await this.eventFor(share.userId, share.eventId) : null,
    };
  }

  /** The plan as the sharer sees it (a mystery spot stays approximate until it's revealed to them). */
  private async eventFor(userId: string, eventId: string): Promise<PublicLiveView['event']> {
    try {
      const e = await this.events.detailFor(userId, eventId);
      const place =
        e.location.kind === 'exact'
          ? (e.location.placeName ?? e.location.address)
          : e.location.neighbourhoodName;
      return { title: e.title, startsAt: e.startsAt, endsAt: e.endsAt, place };
    } catch {
      return null;
    }
  }

  // ---------- housekeeping (worker) ----------

  /** Shares whose time is up end, and their owners are told. */
  async endExpired(now: Date = new Date()): Promise<number> {
    const ended = await this.db
      .update(liveLocationShares)
      .set({ endedAt: sql`${liveLocationShares.expiresAt}` })
      .where(and(isNull(liveLocationShares.endedAt), lte(liveLocationShares.expiresAt, now)))
      .returning({ userId: liveLocationShares.userId });
    const userIds = [...new Set(ended.map((r) => r.userId))];
    if (userIds.length > 0)
      await this.notifications.notify(userIds, 'live_share_ended', {}, { now });
    return ended.length;
  }

  /**
   * Hourly: nothing older than 24 h survives. The cutoff is an hour inside the limit so that, run hourly,
   * no point ever lives longer than 24 hours.
   */
  async purge(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - (S.liveLocationRetentionMs - HOUR_MS));
    const points = await this.db
      .delete(liveLocationPoints)
      .where(lt(liveLocationPoints.recordedAt, cutoff))
      .returning({ id: liveLocationPoints.id });
    const shares = await this.db
      .delete(liveLocationShares)
      .where(and(isNotNull(liveLocationShares.endedAt), lt(liveLocationShares.endedAt, cutoff)))
      .returning({ id: liveLocationShares.id });
    return points.length + shares.length;
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const [contacts, shares] = await Promise.all([
      this.contacts(userId),
      this.db
        .select({
          id: liveLocationShares.id,
          eventId: liveLocationShares.eventId,
          startedAt: liveLocationShares.startedAt,
          expiresAt: liveLocationShares.expiresAt,
          endedAt: liveLocationShares.endedAt,
          sosAt: liveLocationShares.sosAt,
        })
        .from(liveLocationShares)
        .where(eq(liveLocationShares.userId, userId)),
    ]);
    const points =
      shares.length === 0
        ? []
        : await this.db
            .select({
              shareId: liveLocationPoints.shareId,
              lat: liveLocationPoints.lat,
              lng: liveLocationPoints.lng,
              recordedAt: liveLocationPoints.recordedAt,
            })
            .from(liveLocationPoints)
            .where(
              inArray(
                liveLocationPoints.shareId,
                shares.map((s) => s.id),
              ),
            );
    return { trustedContacts: contacts, liveLocationShares: shares, liveLocationPoints: points };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(liveLocationShares).where(eq(liveLocationShares.userId, userId));
    await tx.delete(trustedContacts).where(eq(trustedContacts.userId, userId));
  }
}
