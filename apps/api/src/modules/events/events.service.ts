import { Inject, Injectable } from '@nestjs/common';
import {
  type AddHostBody,
  type CreateEventBody,
  decodeCursor,
  DEFAULT_REFUND_POLICY,
  encodeCursor,
  type EventDetail,
  type EventList,
  type EventSummary,
  type EventWhere,
  genderOnly,
  type GeoPoint,
  LIMITS,
  type ModerationPreview,
  type MyEventsQuery,
  type PublicEventView,
  TimeIdCursor,
  type UpdateEventBody,
} from '@touchgrass/shared';
import { and, asc, desc, eq, gt, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { randomInt } from 'node:crypto';
import { uuidv7 } from 'uuidv7';
import { AdminScopeService, type CityScope, inScope } from '../../common/auth/admin-scope.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import {
  eventHosts,
  eventInterests,
  eventInvites,
  events,
  eventVibeTags,
  rsvps,
} from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { withRedisLock } from '../../infra/redis/redis-lock.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { CitiesService } from '../cities/cities.service.js';
import { InterestsService } from '../interests/interests.service.js';
import { MediaService } from '../media/media.service.js';
import { type AfterCommit, GONE } from '../moderation/moderation-targets.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { SanctionsReader } from '../moderation/sanctions-reader.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { FeatureFlagsService } from '../platform/feature-flags.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { VenuesService } from '../venues/venues.service.js';
import { EventAccessService } from './event-access.service.js';
import {
  canViewEvent,
  genderBucket,
  genderOnlyError,
  hidesSpot,
  holdsSeat,
  matchesGenderOnly,
  materialChanges,
} from './event.policy.js';
import { EventHooks } from './event-hooks.js';
import { type EventCore, EventStore } from './event-store.service.js';
import { EventViewsService } from './event-views.service.js';
import { EventViewService } from './event-view.service.js';
import { mysteryCenter } from './mystery.js';
import { eventLockKey, WaitlistService } from './waitlist.service.js';

export const EVENT_CREATED_EVENT = 'event.created';
export const EVENT_UPDATED_EVENT = 'event.updated';
export const EVENT_CANCELLED_EVENT = 'event.cancelled';
export const EVENT_COMPLETED_EVENT = 'event.completed';
export const EVENT_HOST_ADDED_EVENT = 'event.host_added';

const SLUG_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const CURATOR_ROLES = ['super_admin', 'admin', 'city_curator'];

export function randomSlug(length: number = LIMITS.event.slugLength): string {
  return Array.from({ length }, () =>
    SLUG_ALPHABET.charAt(randomInt(0, SLUG_ALPHABET.length)),
  ).join('');
}

interface ResolvedWhere {
  venueId: string | null;
  point: GeoPoint;
  address: string;
  placeName: string | null;
  cityId: string;
  neighbourhoodId: string | null;
  centroid: GeoPoint | null;
  key: string;
}

/** Plot, edit, publish, cancel and complete events (F-EVT-01/02/03/16/17); host roles (F-EVT-13). */
@Injectable()
export class EventsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly store: EventStore,
    private readonly access: EventAccessService,
    private readonly view: EventViewService,
    private readonly waitlist: WaitlistService,
    private readonly outbox: OutboxService,
    private readonly flags: FeatureFlagsService,
    private readonly cities: CitiesService,
    private readonly interests: InterestsService,
    private readonly media: MediaService,
    private readonly graph: SocialGraphService,
    private readonly venues: VenuesService,
    private readonly hooks: EventHooks,
    private readonly views: EventViewsService,
    private readonly moderation: ModerationService,
    private readonly sanctions: SanctionsReader,
    private readonly profiles: ProfilesService,
    private readonly scope: AdminScopeService,
  ) {}

  // ---------- plot ----------

  async create(
    userId: string,
    roles: readonly string[],
    body: CreateEventBody,
    now: Date = new Date(),
    /** Crew sessions are created by the crews module, never through the public plot endpoint. */
    opts: { type?: 'crew_session' } = {},
  ): Promise<EventDetail> {
    // Crew sessions are generated on the crew's behalf; muting applies to what a person posts themselves.
    if (opts.type !== 'crew_session') await this.sanctions.assertCanPost(userId, now);
    const screen = this.moderation.screen(body.title, body.description);
    const ctx = await this.access.context(userId);
    const curated = body.type === 'curated' && opts.type !== 'crew_session';
    if (curated && !roles.some((r) => CURATOR_ROLES.includes(r)))
      throw new AppError('FORBIDDEN', 'Only curators publish curated events');
    // Curated plans are published by the team on TouchGrass's behalf, not as a personal plan.
    if (!curated && (await this.flags.isEnabled('require_verification_to_host')) && !ctx.verified)
      throw new AppError('VERIFICATION_REQUIRED', 'Get verified to plot');
    if (body.pricePaise > 0) await this.assertPaidAllowed(userId, body.allowPlusOnes);
    if (!matchesGenderOnly(body.visibility, ctx)) throw genderOnlyError(body.visibility);
    this.assertTiming(new Date(body.startsAt), now);
    await this.assertTaxonomy(body.categoryInterestId, body.interestIds, body.vibeTagIds);
    if (body.coverMediaId) await this.assertCover(userId, body.coverMediaId);
    const where = await this.resolveWhere(body.where);
    // City curators publish curated plans only in the cities they curate (D-118).
    if (curated && !inScope(await this.scope.scope({ userId, roles }), where.cityId))
      throw new AppError('FORBIDDEN', 'That place is in a city you do not curate', {
        reason: 'OTHER_CITY',
      });

    const id = uuidv7();
    // Mystery and private plans publish a fuzzed centre, so feeds and maps never give the spot away.
    const approx = hidesSpot(body)
      ? mysteryCenter(id, where.point, where.centroid, this.env.SIGNED_URL_SECRET)
      : where.point;
    const status = body.publish ? 'published' : 'draft';
    await this.db.transaction(async (tx) => {
      const slug = await this.uniqueSlug(tx);
      await tx.insert(events).values({
        id,
        slug,
        type: opts.type ?? body.type,
        status,
        title: body.title,
        description: body.description,
        coverMediaId: body.coverMediaId,
        categoryInterestId: body.categoryInterestId,
        cityId: where.cityId,
        neighbourhoodId: where.neighbourhoodId,
        venueId: where.venueId,
        location: where.point,
        address: where.address,
        placeName: where.placeName,
        approxCenter: approx,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        capacity: body.capacity,
        minGroupSize: body.minGroupSize,
        pricePaise: body.pricePaise,
        refundPolicy: body.pricePaise > 0 ? (body.refundPolicy ?? DEFAULT_REFUND_POLICY) : null,
        visibility: body.visibility,
        balancedMaxSharePct: body.visibility === 'balanced' ? body.balancedMaxSharePct : null,
        soloFriendly: body.soloFriendly,
        smallGroup: body.smallGroup,
        mystery: body.mystery,
        mysteryRevealMinutesBefore: body.mysteryRevealMinutesBefore,
        allowPlusOnes: body.allowPlusOnes,
        chatEnabled: body.chatEnabled,
        indoor: body.indoor,
        accessibility: body.accessibility,
        creatorUserId: userId,
        publishedAt: body.publish ? now : null,
        heldAt: screen.flagged ? now : null,
      });
      await this.moderation.flagText({ type: 'event', id, cityId: where.cityId }, screen, tx);
      await this.replaceTaxonomy(tx, id, body.interestIds, body.vibeTagIds);
      await tx.insert(eventHosts).values({ eventId: id, userId, role: 'host' });
      // The host holds a seat at their own plan.
      await tx.insert(rsvps).values({
        eventId: id,
        userId,
        status: 'going',
        genderBucket: genderBucket(ctx.gender, ctx.verified),
      });
      // A held plan is announced to squads and feeds only once a moderator releases it.
      if (body.publish && !screen.flagged)
        await this.emitCreated(tx, id, userId, where.cityId, body.visibility);
    });
    return this.detailFor(userId, id);
  }

  async publish(userId: string, eventId: string, now: Date = new Date()): Promise<EventDetail> {
    const core = await this.access.requireHost(userId, eventId, { roles: ['host'] });
    if (core.status !== 'draft') throw new AppError('CONFLICT', 'Already published');
    this.assertTiming(core.startsAt, now);
    await this.db.transaction(async (tx) => {
      await tx
        .update(events)
        .set({ status: 'published', publishedAt: now })
        .where(and(eq(events.id, eventId), eq(events.status, 'draft')));
      if (!core.held) await this.emitCreated(tx, eventId, userId, core.cityId, core.visibility);
    });
    await this.store.invalidate(eventId);
    return this.detailFor(userId, eventId);
  }

  // ---------- edit ----------

  async update(
    userId: string,
    eventId: string,
    body: UpdateEventBody,
    now: Date = new Date(),
  ): Promise<EventDetail> {
    await this.applyUpdate(userId, eventId, body, now);
    return this.detailFor(userId, eventId);
  }

  /** Staff edit from the admin dashboard (F-WEB-03): any plan in the cities they may act in. */
  async staffUpdate(
    userId: string,
    eventId: string,
    body: UpdateEventBody,
    scope: CityScope,
    now: Date = new Date(),
  ): Promise<void> {
    await this.applyUpdate(userId, eventId, body, now, { staff: scope });
  }

  private async applyUpdate(
    userId: string,
    eventId: string,
    body: UpdateEventBody,
    now: Date = new Date(),
    opts: { staff?: CityScope } = {},
  ): Promise<void> {
    const before = opts.staff
      ? await this.requireStaff(eventId, opts.staff)
      : await this.access.requireHost(userId, eventId, { roles: ['host', 'co_host'] });
    if (before.status === 'cancelled' || before.status === 'completed')
      throw new AppError('EVENT_CLOSED', 'This plan is over');
    const price = body.pricePaise ?? before.pricePaise;
    if (body.pricePaise !== undefined && body.pricePaise !== before.pricePaise) {
      if (await this.hooks.hasPayments(eventId))
        throw new AppError('NOT_ELIGIBLE', "The price can't change once people have paid", {
          reason: 'PRICE_LOCKED',
        });
      if (body.pricePaise > 0)
        await this.assertPaidAllowed(userId, body.allowPlusOnes ?? before.allowPlusOnes);
    } else if (price > 0 && body.allowPlusOnes === true) {
      throw new AppError('NOT_ELIGIBLE', 'Paid plans have no +1s', { reason: 'NO_PLUS_ONES' });
    }
    const refundPolicy =
      price > 0 ? (body.refundPolicy ?? before.refundPolicy ?? DEFAULT_REFUND_POLICY) : null;
    const startsAt = body.startsAt ? new Date(body.startsAt) : before.startsAt;
    const endsAt = body.endsAt ? new Date(body.endsAt) : before.endsAt;
    if (endsAt.getTime() <= startsAt.getTime())
      throw new AppError('VALIDATION_FAILED', 'Must end after it starts', [
        { path: 'endsAt', message: 'Must end after it starts', code: 'custom' },
      ]);
    if (endsAt.getTime() - startsAt.getTime() > LIMITS.event.maxDurationHours * 3_600_000)
      throw new AppError('VALIDATION_FAILED', 'Too long', [
        { path: 'endsAt', message: 'Too long', code: 'custom' },
      ]);
    if (body.startsAt) this.assertTiming(startsAt, now);
    const visibility = body.visibility ?? before.visibility;
    const share =
      body.balancedMaxSharePct !== undefined
        ? body.balancedMaxSharePct
        : before.balancedMaxSharePct;
    if (visibility === 'balanced' && share === null)
      throw new AppError('VALIDATION_FAILED', 'Balanced events need a ratio cap', [
        { path: 'balancedMaxSharePct', message: 'Required', code: 'custom' },
      ]);
    if (genderOnly(visibility) !== null && before.visibility !== visibility) {
      const ctx = await this.access.context(before.creatorUserId);
      if (!matchesGenderOnly(visibility, ctx)) throw genderOnlyError(visibility);
    }
    const smallGroup = body.smallGroup ?? before.smallGroup;
    const capacity = body.capacity ?? before.capacity;
    if (
      smallGroup &&
      (capacity < LIMITS.event.smallGroupMin || capacity > LIMITS.event.smallGroupMax)
    )
      throw new AppError('VALIDATION_FAILED', 'Small-group events hold 4–8 people', [
        { path: 'capacity', message: 'Out of range', code: 'custom' },
      ]);
    if (body.categoryInterestId || body.interestIds || body.vibeTagIds)
      await this.assertTaxonomy(
        body.categoryInterestId ?? before.categoryInterestId,
        body.interestIds ?? [],
        body.vibeTagIds ?? [],
      );
    if (body.coverMediaId) await this.assertCover(userId, body.coverMediaId);
    const where = body.where ? await this.resolveWhere(body.where) : null;
    if (opts.staff && where && !inScope(opts.staff, where.cityId))
      throw new AppError('FORBIDDEN', 'That place is in a city you do not curate', {
        reason: 'OTHER_CITY',
      });
    const beforeExact = await this.store.exactLocation(eventId);
    const screen = this.moderation.screen(body.title, body.description);

    await withRedisLock(this.redis, eventLockKey(eventId), () =>
      this.db.transaction(async (tx) => {
        const locked = await this.store.core(eventId, tx, { lock: true });
        if (!locked) throw AppError.notFound('Event');
        const counts = await this.store.seatCounts(eventId, tx);
        if (capacity < counts.seats)
          throw new AppError('CONFLICT', `${counts.seats} people are already going`, {
            reason: 'CAPACITY_BELOW_GOING',
            going: counts.seats,
          });
        const mystery = body.mystery ?? locked.mystery;
        const point = where?.point ?? beforeExact?.point ?? locked.approxCenter;
        const hidden = hidesSpot({ mystery, visibility });
        const needsApprox = where !== null || hidden !== hidesSpot(locked);
        const approx = needsApprox
          ? hidden
            ? mysteryCenter(
                eventId,
                point,
                where?.centroid ?? (await this.centroidOf(locked.neighbourhoodId)),
                this.env.SIGNED_URL_SECRET,
              )
            : point
          : undefined;
        await tx
          .update(events)
          .set({
            title: body.title,
            description: body.description,
            coverMediaId: body.coverMediaId,
            categoryInterestId: body.categoryInterestId,
            ...(where
              ? {
                  venueId: where.venueId,
                  location: where.point,
                  address: where.address,
                  placeName: where.placeName,
                  cityId: where.cityId,
                  neighbourhoodId: where.neighbourhoodId,
                }
              : {}),
            ...(approx ? { approxCenter: approx } : {}),
            startsAt: body.startsAt ? startsAt : undefined,
            endsAt: body.endsAt ? endsAt : undefined,
            capacity: body.capacity,
            minGroupSize: body.minGroupSize,
            visibility: body.visibility,
            balancedMaxSharePct: visibility === 'balanced' ? share : null,
            soloFriendly: body.soloFriendly,
            smallGroup: body.smallGroup,
            mystery: body.mystery,
            mysteryRevealMinutesBefore: body.mysteryRevealMinutesBefore,
            allowPlusOnes: body.allowPlusOnes,
            chatEnabled: body.chatEnabled,
            indoor: body.indoor,
            accessibility: body.accessibility,
            pricePaise: body.pricePaise,
            refundPolicy,
            // A clean edit doesn't lift an existing hold: a moderator still reviews it.
            ...(screen.flagged ? { heldAt: now } : {}),
          })
          .where(eq(events.id, eventId));
        await this.moderation.flagText(
          { type: 'event', id: eventId, cityId: locked.cityId },
          screen,
          tx,
        );
        if (body.interestIds || body.vibeTagIds) {
          const current = await this.store.taxonomy(eventId);
          await this.replaceTaxonomy(
            tx,
            eventId,
            body.interestIds ?? current.interestIds,
            body.vibeTagIds ?? current.vibeTagIds,
          );
        }
        const changes = materialChanges(
          {
            startsAt: locked.startsAt,
            endsAt: locked.endsAt,
            locationKey: beforeExact ? `${beforeExact.point.lat},${beforeExact.point.lng}` : '',
            pricePaise: locked.pricePaise,
          },
          {
            startsAt,
            endsAt,
            locationKey: where
              ? where.key
              : beforeExact
                ? `${beforeExact.point.lat},${beforeExact.point.lng}`
                : '',
            pricePaise: price,
          },
        );
        if (changes.length > 0 && locked.status === 'published') {
          // Payload never carries the location itself (mystery events, F-EVT-12).
          await this.outbox.add(tx, {
            aggregateType: 'event',
            aggregateId: eventId,
            type: EVENT_UPDATED_EVENT,
            payload: { eventId, changes, byUserId: userId },
          });
        }
        if (capacity > locked.capacity) {
          const fresh = await this.store.core(eventId, tx, { lock: true });
          if (fresh) await this.waitlist.promote(tx, fresh, now);
        }
      }),
    );
    await this.store.invalidate(eventId);
  }

  async cancel(
    userId: string,
    eventId: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<EventDetail> {
    await this.applyCancel(userId, eventId, reason, now);
    return this.detailFor(userId, eventId);
  }

  /** Staff cancel (F-WEB-03): attendees are told and refunded exactly as when a host cancels. */
  async staffCancel(
    userId: string,
    eventId: string,
    reason: string,
    scope: CityScope,
    now: Date = new Date(),
  ): Promise<void> {
    await this.applyCancel(userId, eventId, reason, now, { staff: scope });
  }

  private async applyCancel(
    userId: string,
    eventId: string,
    reason: string,
    now: Date = new Date(),
    opts: { staff?: CityScope } = {},
  ): Promise<void> {
    if (opts.staff) await this.requireStaff(eventId, opts.staff);
    else await this.access.requireHost(userId, eventId, { roles: ['host'] });
    await withRedisLock(this.redis, eventLockKey(eventId), () =>
      this.db.transaction(async (tx) => {
        const core = await this.store.core(eventId, tx, { lock: true });
        if (!core) throw AppError.notFound('Event');
        if (core.status === 'cancelled') return;
        if (core.status === 'completed' || core.endsAt.getTime() <= now.getTime())
          throw new AppError('EVENT_CLOSED', 'This plan is already over');
        await this.cancelInTx(tx, core, reason, userId, now);
      }),
    );
    await this.store.invalidate(eventId);
  }

  /** Staff may act on any plan in their cities, whoever hosts it. */
  async requireStaff(eventId: string, scope: CityScope): Promise<EventCore> {
    const core = await this.store.core(eventId);
    if (!core) throw AppError.notFound('Event');
    if (!inScope(scope, core.cityId))
      throw new AppError('FORBIDDEN', 'That plan is in a city you do not curate', {
        reason: 'OTHER_CITY',
      });
    return core;
  }

  private async cancelInTx(
    tx: Tx,
    core: EventCore,
    reason: string,
    byUserId: string | null,
    now: Date,
  ): Promise<void> {
    await tx
      .update(events)
      // A cancelled plan is never pinned to a feed any more.
      .set({
        status: 'cancelled',
        cancelledReason: reason || null,
        cancelledAt: now,
        featuredUntil: null,
        featuredRank: null,
        featuredBy: null,
      })
      .where(eq(events.id, core.id));
    await this.waitlist.withdraw(tx, core.id);
    await this.outbox.add(tx, {
      aggregateType: 'event',
      aggregateId: core.id,
      type: EVENT_CANCELLED_EVENT,
      payload: {
        eventId: core.id,
        reason,
        byUserId,
        pricePaise: core.pricePaise,
        wasPublished: core.status === 'published',
      },
    });
  }

  /** Every few minutes: published events that have ended become completed (feeds recaps, Lore, reliability). */
  async completeEnded(now: Date = new Date()): Promise<number> {
    const done = await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(events)
        .set({ status: 'completed', completedAt: now })
        .where(and(eq(events.status, 'published'), lte(events.endsAt, now)))
        .returning({ id: events.id, cityId: events.cityId });
      for (const r of rows) {
        await this.outbox.add(tx, {
          aggregateType: 'event',
          aggregateId: r.id,
          type: EVENT_COMPLETED_EVENT,
          payload: { eventId: r.id, cityId: r.cityId },
        });
      }
      // Drafts that were never published simply lapse.
      await tx
        .delete(events)
        .where(
          and(
            eq(events.status, 'draft'),
            lt(events.endsAt, new Date(now.getTime() - 30 * 86_400_000)),
          ),
        );
      return rows;
    });
    for (const r of done) await this.store.invalidate(r.id);
    return done.length;
  }

  // ---------- read ----------

  /** Someone opened the plan: same as `detailFor`, and counted as a view for host analytics (F-HST-02). */
  async open(viewerId: string, eventId: string, now: Date = new Date()): Promise<EventDetail> {
    const detail = await this.detailFor(viewerId, eventId);
    if (!detail.viewer.isHost) await this.views.record(eventId, viewerId, now);
    return detail;
  }

  /** Paid plans (F-HST-01): approved hosts only, and no +1s (every seat is a ticket). */
  private async assertPaidAllowed(userId: string, allowPlusOnes: boolean): Promise<void> {
    if (!(await this.hooks.canHostPaid(userId)))
      throw new AppError('NOT_ELIGIBLE', 'Paid plans need an approved host application', {
        reason: 'PAID_NEEDS_HOST_APPROVAL',
      });
    if (allowPlusOnes)
      throw new AppError('NOT_ELIGIBLE', 'Paid plans have no +1s', { reason: 'NO_PLUS_ONES' });
  }

  async detailFor(viewerId: string, eventId: string): Promise<EventDetail> {
    const { core, ctx, facts } = await this.access.visibleOrThrow(viewerId, eventId);
    return this.view.detail(ctx, core, facts);
  }

  async idForSlug(slug: string): Promise<string> {
    const id = await this.store.idBySlug(slug);
    if (!id) throw AppError.notFound('Event');
    return id;
  }

  async publicBySlug(slug: string): Promise<PublicEventView> {
    const core = await this.store.core(await this.idForSlug(slug));
    if (!core || core.status === 'draft' || core.held) throw AppError.notFound('Event');
    return this.view.publicView(core);
  }

  /** Upcoming plans I'm on (hosting, going, waitlisted, interested), plans I host, or past plans. */
  /**
   * Plans for someone's calendar feed (F-CAL-01): ones they host or hold a seat at, cancelled ones included so
   * subscribed calendars mark them cancelled. Locations come through the viewer-safe summary (mystery-safe).
   */
  async calendarFor(
    userId: string,
    from: Date,
    to: Date,
    now: Date = new Date(),
  ): Promise<{ summary: EventSummary; description: string; updatedAt: Date }[]> {
    const rows = await this.db
      .select({ id: events.id, updatedAt: events.updatedAt })
      .from(events)
      .where(
        and(
          gte(events.startsAt, from),
          lt(events.startsAt, to),
          inArray(events.status, ['published', 'cancelled', 'completed']),
          or(
            sql`${events.id} IN (SELECT event_id FROM event_hosts WHERE user_id = ${userId})`,
            sql`${events.id} IN (SELECT event_id FROM rsvps WHERE user_id = ${userId} AND status IN ('going','checked_in','interested'))`,
          ),
        ),
      )
      .orderBy(asc(events.startsAt))
      .limit(500);
    const cores = await this.store.coresByIds(rows.map((r) => r.id));
    const ctx = await this.access.context(userId);
    const facts = await this.access.factsFor(
      ctx,
      cores.map((c) => c.id),
    );
    const visible = cores.filter((c) => {
      const f = facts.get(c.id);
      return f !== undefined && canViewEvent(f, c);
    });
    const summaries = await this.view.summaries(ctx, visible, facts, now);
    const updated = new Map(rows.map((r) => [r.id, r.updatedAt]));
    const byId = new Map(visible.map((c) => [c.id, c]));
    return summaries.map((summary) => ({
      summary,
      description: byId.get(summary.id)?.description ?? '',
      updatedAt: updated.get(summary.id) ?? now,
    }));
  }

  async mine(userId: string, q: MyEventsQuery, now: Date = new Date()): Promise<EventList> {
    const after = q.cursor ? decodeCursor(q.cursor, TimeIdCursor) : null;
    const hostIds = sql`SELECT event_id FROM event_hosts WHERE user_id = ${userId}`;
    const rsvpIds = sql`SELECT event_id FROM rsvps WHERE user_id = ${userId} AND status IN ('going','checked_in','waitlisted','interested')`;
    const seatIds = sql`SELECT event_id FROM rsvps WHERE user_id = ${userId} AND status IN ('going','checked_in')`;
    const conds = [];
    if (q.scope === 'upcoming') {
      conds.push(
        gte(events.endsAt, now),
        inArray(events.status, ['published', 'cancelled', 'draft']),
      );
      conds.push(
        or(
          sql`${events.id} IN (${hostIds})`,
          and(ne(events.status, 'draft'), sql`${events.id} IN (${rsvpIds})`),
        ),
      );
    } else if (q.scope === 'hosting') {
      conds.push(
        gte(events.endsAt, now),
        sql`${events.id} IN (${hostIds})`,
        ne(events.status, 'completed'),
      );
    } else {
      conds.push(
        or(lt(events.endsAt, now), eq(events.status, 'completed')),
        ne(events.status, 'draft'),
      );
      conds.push(or(sql`${events.id} IN (${hostIds})`, sql`${events.id} IN (${seatIds})`));
    }
    const ascending = q.scope !== 'past';
    if (after) {
      const t = new Date(after.t);
      conds.push(
        ascending
          ? or(gt(events.startsAt, t), and(eq(events.startsAt, t), gt(events.id, after.id)))
          : or(lt(events.startsAt, t), and(eq(events.startsAt, t), lt(events.id, after.id))),
      );
    }
    const rows = await this.db
      .select({ id: events.id, startsAt: events.startsAt })
      .from(events)
      .where(and(...conds))
      .orderBy(
        ...(ascending
          ? [asc(events.startsAt), asc(events.id)]
          : [desc(events.startsAt), desc(events.id)]),
      )
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const cores = await this.store.coresByIds(page.map((r) => r.id));
    const ordered = page.flatMap((r) => cores.filter((c) => c.id === r.id));
    const ctx = await this.access.context(userId);
    const facts = await this.access.factsFor(
      ctx,
      ordered.map((c) => c.id),
    );
    const visible = ordered.filter((c) => {
      const f = facts.get(c.id);
      return f !== undefined && canViewEvent(f, c);
    });
    const items = await this.view.summaries(ctx, visible, facts, now);
    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ t: last.startsAt.toISOString(), id: last.id })
          : null,
    };
  }

  // ---------- hosts (F-EVT-13) ----------

  /** The primary host adds a co-host or welcome host from their squad or the people going. They get a seat. */
  async addHost(userId: string, eventId: string, body: AddHostBody): Promise<EventDetail> {
    const core = await this.access.requireHost(userId, eventId, { roles: ['host'] });
    if (core.status === 'cancelled' || core.status === 'completed')
      throw new AppError('EVENT_CLOSED', 'This plan is over');
    if (body.userId === userId) throw new AppError('CONFLICT', 'You are already the host');
    if (await this.graph.isBlockedEitherWay(userId, body.userId)) throw AppError.notFound('User');
    const target = await this.access.context(body.userId);
    const targetFacts = await this.access.facts(target, eventId);
    const isSquad = (await this.graph.relationshipStatus(userId, body.userId)) === 'squad';
    if (!isSquad && !holdsSeat(targetFacts.rsvp))
      throw new AppError('NOT_ELIGIBLE', 'Co-hosts come from your squad or the people going', {
        reason: 'NOT_CONNECTED',
      });
    if (targetFacts.blockedWithHost) throw AppError.notFound('User');
    if (!matchesGenderOnly(core.visibility, target)) throw genderOnlyError(core.visibility);
    await withRedisLock(this.redis, eventLockKey(eventId), () =>
      this.db.transaction(async (tx) => {
        const locked = await this.store.core(eventId, tx, { lock: true });
        if (!locked) throw AppError.notFound('Event');
        if (!holdsSeat(targetFacts.rsvp)) {
          const counts = await this.store.seatCounts(eventId, tx);
          if (counts.seats >= locked.capacity)
            throw new AppError('EVENT_FULL', 'No seat left for a co-host');
          await tx
            .insert(rsvps)
            .values({
              eventId,
              userId: body.userId,
              status: 'going',
              genderBucket: genderBucket(target.gender, target.verified),
            })
            .onConflictDoUpdate({
              target: [rsvps.eventId, rsvps.userId],
              set: {
                status: 'going',
                genderBucket: genderBucket(target.gender, target.verified),
                waitlistedAt: null,
                cancelledAt: null,
                lateCancel: false,
              },
            });
          await this.waitlist.withdraw(tx, eventId, body.userId);
        }
        await tx
          .insert(eventHosts)
          .values({ eventId, userId: body.userId, role: body.role })
          .onConflictDoUpdate({
            target: [eventHosts.eventId, eventHosts.userId],
            set: { role: body.role },
          });
        await this.outbox.add(tx, {
          aggregateType: 'event',
          aggregateId: eventId,
          type: EVENT_HOST_ADDED_EVENT,
          payload: { eventId, userId: body.userId, role: body.role, byUserId: userId },
        });
      }),
    );
    return this.detailFor(userId, eventId);
  }

  /** Removes a co-host/welcome host (they keep their seat). Co-hosts may also step down themselves. */
  async removeHost(userId: string, eventId: string, targetId: string): Promise<void> {
    const hosts = await this.store.hosts(eventId);
    const me = hosts.find((h) => h.userId === userId);
    const target = hosts.find((h) => h.userId === targetId);
    if (!me) {
      await this.access.requireHost(userId, eventId);
      return;
    }
    if (!target) throw AppError.notFound('Host');
    if (target.role === 'host')
      throw new AppError('CONFLICT', 'The host cannot be removed; cancel the plan instead');
    if (me.role !== 'host' && userId !== targetId)
      throw new AppError('FORBIDDEN', 'Only the host can remove co-hosts');
    await this.db
      .delete(eventHosts)
      .where(and(eq(eventHosts.eventId, eventId), eq(eventHosts.userId, targetId)));
  }

  // ---------- registries ----------

  /** Titles of events the viewer may see (activity feed); invisible ones are omitted so the row is dropped. */
  async visibleTitles(viewerId: string, ids: string[]): Promise<Map<string, string>> {
    const cores = await this.store.coresByIds(ids);
    const ctx = await this.access.context(viewerId);
    const facts = await this.access.factsFor(
      ctx,
      cores.map((c) => c.id),
    );
    return new Map(
      cores.flatMap((c) => {
        const f = facts.get(c.id);
        return f && canViewEvent(f, c) && c.status !== 'draft' ? [[c.id, c.title] as const] : [];
      }),
    );
  }

  /** Report target resolver: events the reporter can see (attendees can always report the plan they were at). */
  async reportTarget(
    reporterId: string,
    eventId: string,
  ): Promise<{ cityId: string; ownerUserId: string } | null> {
    const core = await this.store.core(eventId);
    if (!core) return null;
    const ctx = await this.access.context(reporterId);
    const facts = await this.access.facts(ctx, eventId);
    const attended = facts.rsvp !== null;
    if (!attended && !canViewEvent({ ...facts, blockedWithHost: false }, core)) return null;
    return { cityId: core.cityId, ownerUserId: core.creatorUserId };
  }

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const [mine, hosted, invites] = await Promise.all([
      this.db
        .select({
          eventId: rsvps.eventId,
          title: events.title,
          status: rsvps.status,
          startsAt: events.startsAt,
          checkedInAt: rsvps.checkedInAt,
        })
        .from(rsvps)
        .innerJoin(events, eq(events.id, rsvps.eventId))
        .where(eq(rsvps.userId, userId)),
      this.db
        .select({ eventId: eventHosts.eventId, role: eventHosts.role, title: events.title })
        .from(eventHosts)
        .innerJoin(events, eq(events.id, eventHosts.eventId))
        .where(eq(eventHosts.userId, userId)),
      this.db
        .select({
          eventId: eventInvites.eventId,
          inviteeUserId: eventInvites.inviteeUserId,
          createdAt: eventInvites.createdAt,
        })
        .from(eventInvites)
        .where(eq(eventInvites.invitedBy, userId)),
    ]);
    return { rsvps: mine, hosting: hosted, invitesSent: invites };
  }

  /**
   * Account erasure: future plans they created are cancelled (attendees are told), their RSVPs, host roles and
   * invites are removed. Past plans stay for other attendees' history but no longer point at them as a host.
   */
  async eraseFor(userId: string, tx: Tx, now: Date = new Date()): Promise<string[]> {
    await this.views.eraseFor(userId, tx);
    const created = await tx
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          eq(events.creatorUserId, userId),
          inArray(events.status, ['published', 'draft']),
          gt(events.endsAt, now),
        ),
      );
    const touched: string[] = [];
    for (const { id } of created) {
      const [core] = await this.store.coresByIds([id]);
      if (!core) continue;
      await tx
        .update(events)
        .set({ status: 'cancelled', cancelledReason: 'The host left TouchGrass', cancelledAt: now })
        .where(eq(events.id, id));
      await this.waitlist.withdraw(tx, id);
      await this.outbox.add(tx, {
        aggregateType: 'event',
        aggregateId: id,
        type: EVENT_CANCELLED_EVENT,
        payload: {
          eventId: id,
          reason: 'host_deleted',
          byUserId: null,
          pricePaise: core.pricePaise,
          wasPublished: core.status === 'published',
        },
      });
      touched.push(id);
    }
    const seatEvents = await tx
      .delete(rsvps)
      .where(eq(rsvps.userId, userId))
      .returning({ eventId: rsvps.eventId });
    await tx.update(rsvps).set({ plusOneOf: null }).where(eq(rsvps.plusOneOf, userId));
    await tx.delete(eventHosts).where(eq(eventHosts.userId, userId));
    await tx
      .delete(eventInvites)
      .where(or(eq(eventInvites.invitedBy, userId), eq(eventInvites.inviteeUserId, userId)));
    await this.waitlist.eraseFor(userId, tx);
    return [...touched, ...seatEvents.map((r) => r.eventId)];
  }

  // ---------- helpers ----------

  private assertTiming(startsAt: Date, now: Date): void {
    if (startsAt.getTime() <= now.getTime())
      throw new AppError('VALIDATION_FAILED', 'Pick a time in the future', [
        { path: 'startsAt', message: 'Must be in the future', code: 'custom' },
      ]);
    if (startsAt.getTime() - now.getTime() > LIMITS.event.maxDaysAhead * 86_400_000)
      throw new AppError('VALIDATION_FAILED', 'Too far ahead', [
        { path: 'startsAt', message: `Within ${LIMITS.event.maxDaysAhead} days`, code: 'custom' },
      ]);
  }

  private async assertTaxonomy(
    categoryId: string | null,
    interestIds: string[],
    vibeTagIds: string[],
  ): Promise<void> {
    const allInterests = [...(categoryId ? [categoryId] : []), ...interestIds];
    if (allInterests.length > 0 && !(await this.interests.allActiveInterests(allInterests)))
      throw new AppError('VALIDATION_FAILED', 'Unknown interest', [
        { path: 'interestIds', message: 'Unknown interest', code: 'custom' },
      ]);
    if (vibeTagIds.length > 0 && !(await this.interests.allActiveVibeTags(vibeTagIds)))
      throw new AppError('VALIDATION_FAILED', 'Unknown vibe', [
        { path: 'vibeTagIds', message: 'Unknown vibe', code: 'custom' },
      ]);
  }

  private async assertCover(userId: string, mediaId: string): Promise<void> {
    const asset = await this.media.ownedOrThrow(userId, mediaId);
    if (asset.purpose !== 'event_cover')
      throw new AppError('VALIDATION_FAILED', 'Not a cover image', [
        { path: 'coverMediaId', message: 'Wrong purpose', code: 'custom' },
      ]);
    if (asset.status !== 'ready')
      throw new AppError('MEDIA_NOT_READY', 'Cover is still processing');
  }

  private async resolveWhere(where: EventWhere): Promise<ResolvedWhere> {
    if ('venueId' in where) {
      const v = await this.venueOrThrow(where.venueId);
      const located = await this.cities.locate(v.location);
      return {
        venueId: v.id,
        point: v.location,
        address: v.address,
        placeName: v.name,
        cityId: v.cityId,
        neighbourhoodId: v.neighbourhoodId,
        centroid: located?.centroid ?? null,
        key: `venue:${v.id}`,
      };
    }
    const located = await this.cities.locate(where.point);
    if (!located)
      throw new AppError('VALIDATION_FAILED', 'That spot is outside the cities TouchGrass serves', [
        { path: 'where', message: 'Outside service area', code: 'custom' },
      ]);
    return {
      venueId: null,
      point: where.point,
      address: where.address,
      placeName: where.placeName,
      cityId: located.cityId,
      neighbourhoodId: located.neighbourhoodId,
      centroid: located.centroid,
      key: `${where.point.lat},${where.point.lng}`,
    };
  }

  private async venueOrThrow(id: string) {
    const v = await this.venues.byId(id);
    if (!v) throw AppError.notFound('Venue');
    return v;
  }

  private async centroidOf(neighbourhoodId: string | null): Promise<GeoPoint | null> {
    if (!neighbourhoodId) return null;
    return this.cities.centroid(neighbourhoodId);
  }

  private async uniqueSlug(tx: Tx): Promise<string> {
    for (let i = 0; i < 5; i += 1) {
      const slug = randomSlug();
      const [taken] = await tx
        .select({ id: events.id })
        .from(events)
        .where(eq(events.slug, slug))
        .limit(1);
      if (!taken) return slug;
    }
    throw new AppError('CONFLICT', 'Could not allocate a link, try again');
  }

  private async replaceTaxonomy(
    tx: Tx,
    eventId: string,
    interestIds: string[],
    vibeTagIds: string[],
  ): Promise<void> {
    await tx.delete(eventInterests).where(eq(eventInterests.eventId, eventId));
    await tx.delete(eventVibeTags).where(eq(eventVibeTags.eventId, eventId));
    const i = [...new Set(interestIds)];
    const v = [...new Set(vibeTagIds)];
    if (i.length > 0)
      await tx.insert(eventInterests).values(i.map((interestId) => ({ eventId, interestId })));
    if (v.length > 0)
      await tx.insert(eventVibeTags).values(v.map((vibeTagId) => ({ eventId, vibeTagId })));
  }

  // ---------- moderation (F-SAF-06) ----------

  async moderationPreview(eventId: string): Promise<ModerationPreview> {
    const core = await this.store.core(eventId, this.db, { fresh: true });
    if (!core) return GONE;
    const [cover, names] = await Promise.all([
      core.coverMediaId
        ? this.media
            .byId(core.coverMediaId)
            .then((m) => (m ? this.media.urlsFor(m.variantKeys) : null))
        : Promise.resolve(null),
      this.profiles.displayNames([core.creatorUserId]),
    ]);
    return {
      title: core.title,
      text: core.description || null,
      image: cover,
      owner: { id: core.creatorUserId, displayName: names.get(core.creatorUserId) ?? '' },
      gone: false,
    };
  }

  /** Lifts a hold; a published plan is announced now, as it would have been when created. */
  async releaseHeld(eventId: string, tx: Tx): Promise<AfterCommit> {
    const core = await this.store.core(eventId, tx, { lock: true });
    if (!core?.held) return undefined;
    await tx.update(events).set({ heldAt: null }).where(eq(events.id, eventId));
    if (core.status === 'published')
      await this.emitCreated(tx, eventId, core.creatorUserId, core.cityId, core.visibility);
    return () => this.store.invalidate(eventId);
  }

  /**
   * Takes a plan down: hidden from everyone but its hosts, and an upcoming one is cancelled (refunds and
   * notices follow the normal cancellation path).
   */
  async removeForModeration(eventId: string, tx: Tx, now: Date = new Date()): Promise<AfterCommit> {
    const core = await this.store.core(eventId, tx, { lock: true });
    if (!core) return undefined;
    await tx.update(events).set({ heldAt: now }).where(eq(events.id, eventId));
    if (
      (core.status === 'published' || core.status === 'draft') &&
      core.endsAt.getTime() > now.getTime()
    )
      await this.cancelInTx(tx, core, 'Removed by the TouchGrass team', null, now);
    return () => this.store.invalidate(eventId);
  }

  private async emitCreated(
    tx: Tx,
    eventId: string,
    userId: string,
    cityId: string,
    visibility: string,
  ): Promise<void> {
    // Never includes location: subscribers fetch through the serializer if they need it (F-EVT-12).
    await this.outbox.add(tx, {
      aggregateType: 'event',
      aggregateId: eventId,
      type: EVENT_CREATED_EVENT,
      payload: { eventId, creatorUserId: userId, cityId, visibility },
    });
  }
}
