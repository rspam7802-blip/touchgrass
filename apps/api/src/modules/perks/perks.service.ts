import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminVenue,
  type AdminVenueQuery,
  decodeCursor,
  encodeCursor,
  type EventPerk,
  LIMITS,
  type PerkPass,
  type PerkPassPreview,
  type RedeemPerkBody,
  type UpdateVenuePartnerBody,
  type UpsertPerkBody,
  type VenuePerk,
  zonedParts,
} from '@touchgrass/shared';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import { pepperedHash, randomInviteCode, randomToken } from '../../common/auth/hashing.js';
import type { CityScope } from '../../common/auth/admin-scope.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { perkRedemptions, venuePerks } from '../../infra/database/schema/index.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import type { EventViewerFacts } from '../events/event-access.service.js';
import { EventAccessService } from '../events/event-access.service.js';
import { holdsSeat } from '../events/event.policy.js';
import { type EventCore, EventStore } from '../events/event-store.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { VenuesService } from '../venues/venues.service.js';

type PerkRow = typeof venuePerks.$inferSelect;
const PIN_FAILURES_PER_HOUR = 10;
const NameCursor = z.object({ name: z.string(), id: z.uuid() });

export type PerkBlock = 'NOT_GOING' | 'GROUP_TOO_SMALL' | 'NOT_TODAY' | 'PERK_EXPIRED' | 'CLOSED';

/** Midnight IST of the plan's day, as an instant. */
export function istDayStart(at: Date): Date {
  const p = zonedParts(at);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - 330 * 60_000);
}

/** Pure rule (F-PAY-04): who can use a perk right now. */
export function perkBlock(
  perk: { active: boolean; validUntil: Date | null; minGroupSize: number },
  event: { status: string; startsAt: Date; endsAt: Date },
  holdsASeat: boolean,
  groupSize: number,
  now: Date,
): PerkBlock | null {
  if (!perk.active || (perk.validUntil && perk.validUntil < now)) return 'PERK_EXPIRED';
  if (event.status === 'cancelled' || event.status === 'draft') return 'CLOSED';
  if (!holdsASeat) return 'NOT_GOING';
  if (groupSize < perk.minGroupSize) return 'GROUP_TOO_SMALL';
  if (
    now < istDayStart(event.startsAt) ||
    now.getTime() > event.endsAt.getTime() + LIMITS.payments.perkGraceMs
  )
    return 'NOT_TODAY';
  return null;
}

function toPerk(p: PerkRow): VenuePerk {
  return {
    id: p.id,
    venueId: p.venueId,
    title: p.title,
    description: p.description,
    minGroupSize: p.minGroupSize,
    validUntil: p.validUntil?.toISOString() ?? null,
    active: p.active,
  };
}

/**
 * Venue partnerships and perks (F-PAY-04). Perks at a partner venue show on plans held there. Someone holding a
 * seat gets a pass (QR + short code) on the day; venue staff confirm it with the venue's PIN on the web page the
 * QR opens. Every redemption is recorded.
 */
@Injectable()
export class PerksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly venues: VenuesService,
    private readonly store: EventStore,
    private readonly access: EventAccessService,
    private readonly profiles: ProfilesService,
  ) {}

  private hash(token: string): string {
    return pepperedHash(this.env.TOKEN_HASH_PEPPER, `perk:${token}`);
  }

  private passUrl(token: string): string {
    return `${this.env.WEB_PUBLIC_URL}/r/${token}`;
  }

  private async activePerks(venueId: string): Promise<PerkRow[]> {
    return this.db
      .select()
      .from(venuePerks)
      .where(and(eq(venuePerks.venueId, venueId), eq(venuePerks.active, true)))
      .orderBy(venuePerks.createdAt);
  }

  /** Event detail hook. */
  async forEvent(
    userId: string,
    core: EventCore,
    facts: EventViewerFacts,
    now: Date = new Date(),
  ): Promise<EventPerk[]> {
    if (!core.venueId) return [];
    const info = (await this.venues.partnerInfo([core.venueId])).get(core.venueId);
    if (!info?.isPartner) return [];
    const perks = await this.activePerks(core.venueId);
    if (perks.length === 0) return [];
    const [counts, redeemed] = await Promise.all([
      this.store.seatCounts(core.id),
      this.db
        .select({ perkId: perkRedemptions.perkId, at: perkRedemptions.redeemedAt })
        .from(perkRedemptions)
        .where(and(eq(perkRedemptions.eventId, core.id), eq(perkRedemptions.userId, userId))),
    ]);
    const used = new Map(redeemed.map((r) => [r.perkId, r.at]));
    const seat = holdsSeat(facts.rsvp) || facts.hostRole !== null;
    return perks.map((p) => {
      const redeemedAt = used.get(p.id) ?? null;
      const block = redeemedAt ? 'ALREADY_REDEEMED' : perkBlock(p, core, seat, counts.seats, now);
      return {
        perk: toPerk(p),
        venueName: info.name,
        canRedeem: block === null,
        reason: block,
        redeemedAt: redeemedAt?.toISOString() ?? null,
      };
    });
  }

  /** A pass for a perk at this plan. Re-asking rotates the QR token (we only store its hash). */
  async pass(
    userId: string,
    eventId: string,
    perkId: string,
    now: Date = new Date(),
  ): Promise<PerkPass> {
    const { core, facts } = await this.access.visibleOrThrow(userId, eventId);
    const [perk] = await this.db.select().from(venuePerks).where(eq(venuePerks.id, perkId));
    if (!perk || perk.venueId !== core.venueId) throw AppError.notFound('Perk');
    const info = (await this.venues.partnerInfo([perk.venueId])).get(perk.venueId);
    if (!info?.isPartner) throw AppError.notFound('Perk');
    const counts = await this.store.seatCounts(eventId);
    const seat = holdsSeat(facts.rsvp) || facts.hostRole !== null;
    const [existing] = await this.db
      .select()
      .from(perkRedemptions)
      .where(
        and(
          eq(perkRedemptions.perkId, perkId),
          eq(perkRedemptions.eventId, eventId),
          eq(perkRedemptions.userId, userId),
        ),
      );
    const expiresAt = new Date(core.endsAt.getTime() + LIMITS.payments.perkGraceMs);
    if (existing?.redeemedAt)
      return {
        code: existing.code,
        qr: '',
        perkTitle: perk.title,
        venueName: info.name,
        expiresAt: existing.expiresAt.toISOString(),
        redeemedAt: existing.redeemedAt.toISOString(),
      };
    const block = perkBlock(perk, core, seat, counts.seats, now);
    if (block)
      throw new AppError('PERK_UNAVAILABLE', 'This perk cannot be used right now', {
        reason: block,
      });
    const token = randomToken();
    const code = existing?.code ?? (await this.freeCode(perkId));
    await this.db
      .insert(perkRedemptions)
      .values({
        id: uuidv7(),
        perkId,
        eventId,
        userId,
        code,
        tokenHash: this.hash(token),
        groupSize: counts.seats,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: [perkRedemptions.perkId, perkRedemptions.eventId, perkRedemptions.userId],
        set: { tokenHash: this.hash(token), groupSize: counts.seats, expiresAt },
      });
    return {
      code,
      qr: this.passUrl(token),
      perkTitle: perk.title,
      venueName: info.name,
      expiresAt: expiresAt.toISOString(),
      redeemedAt: null,
    };
  }

  /** Six-character code not in use by an unredeemed pass for this perk. */
  private async freeCode(perkId: string): Promise<string> {
    for (let i = 0; i < 10; i += 1) {
      const code = randomInviteCode(6);
      const [clash] = await this.db
        .select({ id: perkRedemptions.id })
        .from(perkRedemptions)
        .where(
          and(
            eq(perkRedemptions.perkId, perkId),
            eq(perkRedemptions.code, code),
            isNull(perkRedemptions.redeemedAt),
          ),
        )
        .limit(1);
      if (!clash) return code;
    }
    throw new AppError('INTERNAL', 'Could not allocate a perk code');
  }

  /** What venue staff see after scanning (no phone number, first name only). */
  async preview(token: string): Promise<PerkPassPreview> {
    return this.previewOf(await this.byToken(token));
  }

  private async byToken(token: string) {
    const [row] = await this.db
      .select()
      .from(perkRedemptions)
      .where(eq(perkRedemptions.tokenHash, this.hash(token)))
      .limit(1);
    if (!row) throw AppError.notFound('Perk pass');
    return row;
  }

  private async previewOf(row: typeof perkRedemptions.$inferSelect): Promise<PerkPassPreview> {
    const [perk] = await this.db.select().from(venuePerks).where(eq(venuePerks.id, row.perkId));
    const core = await this.store.core(row.eventId);
    if (!perk || !core) throw AppError.notFound('Perk pass');
    const info = (await this.venues.partnerInfo([perk.venueId])).get(perk.venueId);
    const name = row.userId
      ? ((await this.profiles.displayNames([row.userId])).get(row.userId) ?? '')
      : '';
    return {
      perkTitle: perk.title,
      perkDescription: perk.description,
      venueName: info?.name ?? '',
      eventTitle: core.title,
      firstName: name.split(' ')[0] ?? '',
      groupSize: row.groupSize,
      expiresAt: row.expiresAt.toISOString(),
      redeemedAt: row.redeemedAt?.toISOString() ?? null,
    };
  }

  /**
   * Staff confirm with the venue PIN. Wrong PINs count against the venue (10 per hour), so a PIN cannot be
   * brute-forced even across many IPs. Redeeming twice is refused.
   */
  async redeem(body: RedeemPerkBody, now: Date = new Date()): Promise<PerkPassPreview> {
    let row: typeof perkRedemptions.$inferSelect | undefined;
    if (body.token) row = await this.byToken(body.token);
    else if (body.code && body.venueId) {
      const perkIds = (
        await this.db
          .select({ id: venuePerks.id })
          .from(venuePerks)
          .where(eq(venuePerks.venueId, body.venueId))
      ).map((p) => p.id);
      if (perkIds.length > 0)
        [row] = await this.db
          .select()
          .from(perkRedemptions)
          .where(and(inArray(perkRedemptions.perkId, perkIds), eq(perkRedemptions.code, body.code)))
          // Codes are unique among unused passes; prefer the unused one.
          .orderBy(sql`${perkRedemptions.redeemedAt} IS NOT NULL`, perkRedemptions.createdAt)
          .limit(1);
    }
    if (!row) throw AppError.notFound('Perk pass');
    const [perk] = await this.db.select().from(venuePerks).where(eq(venuePerks.id, row.perkId));
    if (!perk) throw AppError.notFound('Perk pass');
    const lockKey = `perk-pin-fail:${perk.venueId}`;
    const failures = Number((await this.redis.get(lockKey)) ?? 0);
    if (failures >= PIN_FAILURES_PER_HOUR)
      throw new AppError('RATE_LIMITED', 'Too many wrong PINs. Try again in an hour.');
    if (!(await this.venues.checkStaffPin(perk.venueId, body.pin))) {
      await this.redis.multi().incr(lockKey).expire(lockKey, 3600).exec();
      throw new AppError('PERK_UNAVAILABLE', "That PIN doesn't match this venue", {
        reason: 'WRONG_PIN',
      });
    }
    if (row.redeemedAt)
      throw new AppError('PERK_UNAVAILABLE', 'Already used', { reason: 'ALREADY_REDEEMED' });
    if (row.expiresAt < now)
      throw new AppError('PERK_UNAVAILABLE', 'This pass has expired', { reason: 'NOT_TODAY' });
    const [done] = await this.db
      .update(perkRedemptions)
      .set({ redeemedAt: now, method: body.token ? 'qr' : 'code' })
      .where(and(eq(perkRedemptions.id, row.id), isNull(perkRedemptions.redeemedAt)))
      .returning();
    if (!done)
      throw new AppError('PERK_UNAVAILABLE', 'Already used', { reason: 'ALREADY_REDEEMED' });
    return this.previewOf(done);
  }

  // ---------- admin ----------

  /** The venue a perk belongs to (city checks for curators). */
  async perkVenueId(perkId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ venueId: venuePerks.venueId })
      .from(venuePerks)
      .where(eq(venuePerks.id, perkId))
      .limit(1);
    return row?.venueId ?? null;
  }

  async adminVenues(
    q: AdminVenueQuery,
    scope: CityScope = 'all',
  ): Promise<{ items: AdminVenue[]; nextCursor: string | null }> {
    const after = q.cursor ? decodeCursor(q.cursor, NameCursor) : null;
    const rows = await this.venues.adminList({
      q: q.q,
      partner: q.partner,
      after,
      limit: q.limit + 1,
      ...(scope === 'all' ? {} : { cityIds: scope }),
    });
    const page = rows.slice(0, q.limit);
    const ids = page.map((r) => r.id);
    const [info, names, perks, counts] = await Promise.all([
      this.venues.partnerInfo(ids),
      this.venues.toDto(page),
      ids.length
        ? this.db.select().from(venuePerks).where(inArray(venuePerks.venueId, ids))
        : Promise.resolve([]),
      ids.length
        ? this.db
            .select({
              venueId: venuePerks.venueId,
              n: sql<number>`count(${perkRedemptions.id})::int`,
            })
            .from(venuePerks)
            .leftJoin(
              perkRedemptions,
              and(
                eq(perkRedemptions.perkId, venuePerks.id),
                sql`${perkRedemptions.redeemedAt} IS NOT NULL`,
              ),
            )
            .where(inArray(venuePerks.venueId, ids))
            .groupBy(venuePerks.venueId)
        : Promise.resolve([]),
    ]);
    const redemptions = new Map(counts.map((c) => [c.venueId, c.n]));
    const last = page[page.length - 1];
    return {
      items: page.map((v, i) => {
        const p = info.get(v.id);
        return {
          id: v.id,
          name: v.name,
          address: v.address,
          neighbourhoodName: names[i]?.neighbourhoodName ?? null,
          isPartner: p?.isPartner ?? false,
          description: p?.description ?? '',
          hasStaffPin: p?.hasStaffPin ?? false,
          perks: perks.filter((k) => k.venueId === v.id).map(toPerk),
          redemptions: redemptions.get(v.id) ?? 0,
        };
      }),
      nextCursor:
        rows.length > q.limit && last ? encodeCursor({ name: last.name, id: last.id }) : null,
    };
  }

  async setPartner(venueId: string, body: UpdateVenuePartnerBody): Promise<void> {
    await this.venues.setPartner(venueId, body);
  }

  async createPerk(venueId: string, body: UpsertPerkBody): Promise<VenuePerk> {
    if ((await this.venues.partnerInfo([venueId])).size === 0) throw AppError.notFound('Venue');
    const [row] = await this.db
      .insert(venuePerks)
      .values({
        id: uuidv7(),
        venueId,
        ...body,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      })
      .returning();
    if (!row) throw new AppError('INTERNAL', 'Perk not saved');
    return toPerk(row);
  }

  async updatePerk(perkId: string, body: UpsertPerkBody): Promise<VenuePerk> {
    const [row] = await this.db
      .update(venuePerks)
      .set({ ...body, validUntil: body.validUntil ? new Date(body.validUntil) : null })
      .where(eq(venuePerks.id, perkId))
      .returning();
    if (!row) throw AppError.notFound('Perk');
    return toPerk(row);
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select({
        perkId: perkRedemptions.perkId,
        eventId: perkRedemptions.eventId,
        redeemedAt: perkRedemptions.redeemedAt,
      })
      .from(perkRedemptions)
      .where(eq(perkRedemptions.userId, userId));
    return {
      perkRedemptions: rows.map((r) => ({ ...r, redeemedAt: r.redeemedAt?.toISOString() ?? null })),
    };
  }

  /** Redemption counts stay for the venue; the person is detached. */
  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx
      .update(perkRedemptions)
      .set({ userId: null })
      .where(eq(perkRedemptions.userId, userId));
  }
}
