import { Inject, Injectable } from '@nestjs/common';
import { type CheckInBody, type CheckInResult, LIMITS, type Ticket } from '@touchgrass/shared';
import { and, eq } from 'drizzle-orm';
import { createHmac } from 'node:crypto';
import { safeEqualHex } from '../../common/auth/hashing.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { rsvps } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { EventAccessService } from './event-access.service.js';
import { checkInWindowOpen, isLocationRevealed } from './event.policy.js';
import { type EventCore, EventStore } from './event-store.service.js';

export const RSVP_CHECKED_IN_EVENT = 'rsvp.checked_in';
/** Arriving within this long after the start counts as on time (reliability, F-SAF-02). */
export const ON_TIME_GRACE_MS = 15 * 60_000;

const TICKET_PREFIX = 'tg1';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const TICKET_RE = new RegExp(`^${TICKET_PREFIX}\\.(${UUID})\\.(${UUID})\\.([0-9a-f]{32})$`);

/**
 * Check-in (F-EVT-14): hosts scan a person's QR ticket, or the person checks themselves in inside a 150 m
 * geofence. Tickets are HMAC-signed (event + user), so they cannot be forged or reused for another plan.
 * Self check-in is only possible once the spot is revealed to that person, so probing the geofence can never
 * locate a mystery spot early (F-EVT-12).
 */
@Injectable()
export class CheckInService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly store: EventStore,
    private readonly access: EventAccessService,
    private readonly profiles: ProfilesService,
    private readonly outbox: OutboxService,
  ) {}

  private sign(eventId: string, userId: string): string {
    return createHmac('sha256', this.env.SIGNED_URL_SECRET)
      .update(`ticket:${eventId}:${userId}`)
      .digest('hex')
      .slice(0, 32);
  }

  ticketCode(eventId: string, userId: string): string {
    return `${TICKET_PREFIX}.${eventId}.${userId}.${this.sign(eventId, userId)}`;
  }

  parseTicket(qr: string): { eventId: string; userId: string } | null {
    const m = TICKET_RE.exec(qr.trim().toLowerCase());
    if (!m?.[1] || !m[2] || !m[3]) return null;
    return safeEqualHex(m[3], this.sign(m[1], m[2])) ? { eventId: m[1], userId: m[2] } : null;
  }

  async ticket(userId: string, eventId: string): Promise<Ticket> {
    const { core, facts } = await this.access.visibleOrThrow(userId, eventId);
    if (facts.rsvp !== 'going' && facts.rsvp !== 'checked_in')
      throw new AppError('NOT_ELIGIBLE', 'Pull up first to get a ticket', { reason: 'NOT_GOING' });
    return {
      qr: this.ticketCode(eventId, userId),
      eventId,
      validFrom: new Date(core.startsAt.getTime() - LIMITS.checkIn.windowBeforeMs).toISOString(),
      validUntil: new Date(
        Math.min(core.startsAt.getTime() + LIMITS.checkIn.windowAfterMs, core.endsAt.getTime()),
      ).toISOString(),
    };
  }

  async checkIn(
    callerId: string,
    eventId: string,
    body: CheckInBody,
    now: Date = new Date(),
  ): Promise<CheckInResult> {
    if ('qr' in body) return this.scan(callerId, eventId, body.qr, now);
    const { core, facts } = await this.access.visibleOrThrow(callerId, eventId);
    if (facts.rsvp === 'checked_in') return this.result(callerId, eventId);
    if (facts.rsvp !== 'going')
      throw new AppError('NOT_ELIGIBLE', 'Pull up first', { reason: 'NOT_GOING' });
    this.assertWindow(core, now);
    if (!isLocationRevealed(facts, core, now))
      throw new AppError('CHECK_IN_UNAVAILABLE', 'Wait for the reveal', { reason: 'NOT_REVEALED' });
    if (!(await this.store.within(eventId, body.point, LIMITS.checkIn.geofenceMeters)))
      throw new AppError('CHECK_IN_UNAVAILABLE', 'You are not at the spot yet', {
        reason: 'TOO_FAR',
      });
    return this.mark(core, callerId, 'geofence', now);
  }

  private async scan(
    hostId: string,
    eventId: string,
    qr: string,
    now: Date,
  ): Promise<CheckInResult> {
    const core = await this.access.requireHost(hostId, eventId);
    const parsed = this.parseTicket(qr);
    if (!parsed)
      throw new AppError('CHECK_IN_UNAVAILABLE', 'That ticket is not valid', {
        reason: 'INVALID_TICKET',
      });
    if (parsed.eventId !== eventId)
      throw new AppError('CHECK_IN_UNAVAILABLE', 'That ticket is for another plan', {
        reason: 'WRONG_EVENT',
      });
    this.assertWindow(core, now);
    const [row] = await this.db
      .select({ status: rsvps.status })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, eventId), eq(rsvps.userId, parsed.userId)))
      .limit(1);
    if (row?.status === 'checked_in') return this.result(parsed.userId, eventId);
    if (row?.status !== 'going')
      throw new AppError('CHECK_IN_UNAVAILABLE', 'They are not on the list', {
        reason: 'NOT_GOING',
      });
    return this.mark(core, parsed.userId, 'qr', now);
  }

  private assertWindow(core: EventCore, now: Date): void {
    if (!checkInWindowOpen(core, now))
      throw new AppError('CHECK_IN_UNAVAILABLE', 'Check-in is not open', {
        reason: 'WINDOW_CLOSED',
      });
  }

  private async mark(
    core: EventCore,
    userId: string,
    method: 'qr' | 'geofence',
    now: Date,
  ): Promise<CheckInResult> {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(rsvps)
        .set({ status: 'checked_in', checkedInAt: now, checkInMethod: method })
        .where(and(eq(rsvps.eventId, core.id), eq(rsvps.userId, userId), eq(rsvps.status, 'going')))
        .returning({ userId: rsvps.userId });
      if (updated.length === 0) return;
      await this.outbox.add(tx, {
        aggregateType: 'event',
        aggregateId: core.id,
        type: RSVP_CHECKED_IN_EVENT,
        payload: {
          eventId: core.id,
          userId,
          method,
          onTime: now.getTime() <= core.startsAt.getTime() + ON_TIME_GRACE_MS,
        },
      });
    });
    return this.result(userId, core.id);
  }

  private async result(userId: string, eventId: string): Promise<CheckInResult> {
    const [row] = await this.db
      .select({ checkedInAt: rsvps.checkedInAt, method: rsvps.checkInMethod })
      .from(rsvps)
      .where(and(eq(rsvps.eventId, eventId), eq(rsvps.userId, userId)))
      .limit(1);
    if (!row?.checkedInAt || !row.method) throw AppError.notFound('Check-in');
    const name = (await this.profiles.displayNames([userId])).get(userId) ?? '';
    return {
      userId,
      displayName: name,
      checkedInAt: row.checkedInAt.toISOString(),
      method: row.method,
    };
  }
}
