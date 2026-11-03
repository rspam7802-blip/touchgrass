import { Inject, Injectable } from '@nestjs/common';
import type {
  EventDetail,
  EventLocationView,
  EventSummary,
  MediaVariants,
  PersonCard,
  PublicEventView,
  ViewerState,
} from '@touchgrass/shared';
import { DEFAULT_REFUND_POLICY, isPopularPlan, LOCALE_DEFAULTS } from '@touchgrass/shared';
import { and, eq, gt, inArray } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { rsvps, waitlistOffers } from '../../infra/database/schema/index.js';
import { CitiesService } from '../cities/cities.service.js';
import { InterestsService } from '../interests/interests.service.js';
import { MediaService } from '../media/media.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import type { EventViewerFacts, ViewerContext } from './event-access.service.js';
import {
  checkInWindowOpen,
  holdsSeat,
  isLocationRevealed,
  revealTime,
  rsvpEligibility,
} from './event.policy.js';
import {
  type EventCore,
  EventStore,
  type ExactLocation,
  type SeatCounts,
} from './event-store.service.js';
import { MYSTERY_AREA_RADIUS_M } from './mystery.js';
import { WaitlistService } from './waitlist.service.js';
import { EventHooks } from './event-hooks.js';
import { ReliabilityReader } from '../reliability/reliability-reader.js';

/**
 * The ONE serializer for events (F-EVT-12 leak prevention). Every endpoint that returns an event goes through
 * here; the exact spot is fetched only for events `isLocationRevealed` approves for this viewer, and everything
 * else carries the deterministic approximate centre. Leak tests exercise every route against this rule.
 */
@Injectable()
export class EventViewService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly store: EventStore,
    private readonly media: MediaService,
    private readonly interests: InterestsService,
    private readonly cities: CitiesService,
    private readonly people: PeopleService,
    private readonly profiles: ProfilesService,
    private readonly graph: SocialGraphService,
    private readonly waitlist: WaitlistService,
    private readonly hooks: EventHooks,
    private readonly reliability: ReliabilityReader,
  ) {}

  shareUrl(slug: string): string {
    return `${this.env.WEB_PUBLIC_URL}/e/${slug}`;
  }

  async summaries(
    ctx: ViewerContext,
    cores: EventCore[],
    facts: Map<string, EventViewerFacts>,
    now: Date = new Date(),
  ): Promise<EventSummary[]> {
    if (cores.length === 0) return [];
    const ids = cores.map((c) => c.id);
    const revealedIds = cores
      .filter((c) => {
        const f = facts.get(c.id);
        return f !== undefined && isLocationRevealed(f, c, now);
      })
      .map((c) => c.id);
    const [counts, exact, covers, categories, hoods, offers, plusOnes, zones] = await Promise.all([
      this.store.seatCountsMany(ids),
      this.store.exactLocations(revealedIds),
      this.covers(cores),
      this.interests.interestsByIds([
        ...new Set(cores.flatMap((c) => (c.categoryInterestId ? [c.categoryInterestId] : []))),
      ]),
      this.cities.neighbourhoodNames([
        ...new Set(cores.flatMap((c) => (c.neighbourhoodId ? [c.neighbourhoodId] : []))),
      ]),
      this.openOffers(ctx.userId, ids, now),
      this.plusOnes(ctx.userId, ids),
      this.cities.timezones([...new Set(cores.map((c) => c.cityId))]),
    ]);
    const cooldown = await this.reliability.cooldownUntil(ctx.userId, now);
    const cardIds = [
      ...[...facts.values()].flatMap((f) => (f.invitedById ? [f.invitedById] : [])),
      ...[...plusOnes.values()].flatMap((p) => (p.memberId ? [p.memberId] : [])),
    ];
    const cards = await this.people.cards(ctx.userId, cardIds);
    const positions = new Map<string, number>();
    for (const c of cores) {
      if (facts.get(c.id)?.rsvp !== 'waitlisted') continue;
      const pos = await this.waitlist.position(c.id, ctx.userId);
      if (pos !== null) positions.set(c.id, pos);
    }
    return cores.flatMap((c) => {
      const f = facts.get(c.id);
      if (!f) return [];
      const seat = counts.get(c.id) ?? {
        seats: 0,
        waitlisted: 0,
        byBucket: { woman: 0, man: 0, other: 0 },
      };
      const hoodName = c.neighbourhoodId ? (hoods.get(c.neighbourhoodId) ?? null) : null;
      const location = this.location(c, exact.get(c.id) ?? null, hoodName);
      return [
        {
          id: c.id,
          slug: c.slug,
          type: c.type,
          status: c.status,
          title: c.title,
          cover: c.coverMediaId ? (covers.get(c.coverMediaId) ?? null) : null,
          startsAt: c.startsAt.toISOString(),
          endsAt: c.endsAt.toISOString(),
          timezone: zones.get(c.cityId) ?? LOCALE_DEFAULTS.timezone,
          location,
          visibility: c.visibility,
          capacity: c.capacity,
          goingCount: seat.seats,
          spotsLeft: Math.max(0, c.capacity - seat.seats),
          waitlistCount: seat.waitlisted,
          pricePaise: c.pricePaise,
          soloFriendly: c.soloFriendly,
          smallGroup: c.smallGroup,
          mystery: c.mystery,
          indoor: c.indoor,
          accessibility: c.accessibility,
          category: categories.find((i) => i.id === c.categoryInterestId) ?? null,
          viewer: {
            ...this.viewerState(
              c,
              f,
              seat,
              offers.get(c.id) ?? null,
              plusOnes.get(c.id) ?? null,
              cards,
              now,
              cooldown,
            ),
            waitlistPosition: positions.get(c.id) ?? null,
          },
        },
      ];
    });
  }

  async detail(
    ctx: ViewerContext,
    core: EventCore,
    facts: EventViewerFacts,
    now: Date = new Date(),
  ): Promise<EventDetail> {
    const [summary] = await this.summaries(ctx, [core], new Map([[core.id, facts]]), now);
    if (!summary) throw AppError.notFound('Event');
    const [taxonomy, hostCards, soloPercent] = await Promise.all([
      this.store.taxonomy(core.id),
      this.people.cards(
        ctx.userId,
        facts.hosts.map((h) => h.userId),
        { includeSelf: true },
      ),
      this.soloPercent(core.id),
    ]);
    const [payment, perks, lore, crew] = await Promise.all([
      core.pricePaise > 0 ? this.hooks.viewerPayment(ctx.userId, core.id) : Promise.resolve(null),
      this.hooks.perks(ctx.userId, core, facts),
      this.hooks.lore(ctx.userId, core, facts),
      core.type === 'crew_session' ? this.hooks.crew(core.id) : Promise.resolve(null),
    ]);
    const [interests, vibeTags] = await Promise.all([
      this.interests.interestsByIds(taxonomy.interestIds),
      this.interests.vibeTagsByIds(taxonomy.vibeTagIds),
    ]);
    const ORDER = { host: 0, co_host: 1, welcome_host: 2 } as const;
    return {
      ...summary,
      viewer: { ...summary.viewer, payment },
      description: core.description,
      hosts: [...facts.hosts]
        .sort((a, b) => ORDER[a.role] - ORDER[b.role])
        .flatMap((h) => {
          const person = hostCards.get(h.userId);
          return person ? [{ person, role: h.role }] : [];
        }),
      interests,
      vibeTags,
      minGroupSize: core.minGroupSize,
      allowPlusOnes: core.allowPlusOnes,
      balancedMaxSharePct: core.balancedMaxSharePct,
      soloPercent,
      cancelledReason: core.cancelledReason,
      shareUrl: this.shareUrl(core.slug),
      refundPolicy: core.pricePaise > 0 ? (core.refundPolicy ?? DEFAULT_REFUND_POLICY) : null,
      perks,
      lore,
      crew,
      held: core.held,
    };
  }

  /**
   * Link-preview projection (F-EVT-17, F-WEB-01). Public and balanced events show their basics; everything
   * else is a teaser with no title or place. The area name is a neighbourhood, never an address.
   */
  async publicView(core: EventCore): Promise<PublicEventView> {
    const hostName =
      (await this.profiles.displayNames([core.creatorUserId])).get(core.creatorUserId) ?? 'Someone';
    const zone =
      (await this.cities.timezones([core.cityId])).get(core.cityId) ?? LOCALE_DEFAULTS.timezone;
    if (
      core.status === 'draft' ||
      !(core.visibility === 'public' || core.visibility === 'balanced')
    ) {
      return {
        access: 'teaser',
        slug: core.slug,
        hostName,
        startsAt: core.startsAt.toISOString(),
        timezone: zone,
        status: core.status,
      };
    }
    const [counts, covers, hood, city] = await Promise.all([
      this.store.seatCounts(core.id),
      this.covers([core]),
      this.cities.neighbourhoodName(core.neighbourhoodId),
      this.cities.byId(core.cityId),
    ]);
    return {
      access: 'full',
      slug: core.slug,
      title: core.title,
      description: core.description,
      cover: core.coverMediaId ? (covers.get(core.coverMediaId) ?? null) : null,
      startsAt: core.startsAt.toISOString(),
      endsAt: core.endsAt.toISOString(),
      timezone: zone,
      type: core.type,
      cityName: city?.name ?? null,
      areaName: hood,
      hostName,
      goingCount: counts.seats,
      spotsLeft: Math.max(0, core.capacity - counts.seats),
      pricePaise: core.pricePaise,
      mystery: core.mystery,
      status: core.status,
    };
  }

  private location(
    c: EventCore,
    exact: ExactLocation | null,
    neighbourhoodName: string | null,
  ): EventLocationView {
    if (exact)
      return {
        kind: 'exact',
        point: exact.point,
        address: exact.address,
        placeName: exact.placeName,
        neighbourhoodName,
      };
    return {
      kind: 'approximate',
      center: c.approxCenter,
      radiusMeters: MYSTERY_AREA_RADIUS_M,
      neighbourhoodName,
      revealsAt: revealTime(c).toISOString(),
    };
  }

  private viewerState(
    c: EventCore,
    f: EventViewerFacts,
    seat: SeatCounts,
    offer: { expiresAt: Date; mode: 'sequential' | 'broadcast' } | null,
    plusOne: { guestPending: boolean; memberId: string | null } | null,
    cards: Map<string, PersonCard>,
    now: Date,
    cooldown: Date | null,
  ): Omit<ViewerState, 'waitlistPosition'> {
    const eligibility = rsvpEligibility(f, c, now);
    const committed = holdsSeat(f.rsvp) || f.rsvp === 'waitlisted' || f.rsvp === 'held';
    // Repeat no-shows sit out popular plans for a while (F-SAF-02); a waitlist offer still counts.
    const cooled =
      cooldown !== null && !offer && isPopularPlan(c.capacity, seat.seats, seat.waitlisted);
    let blockedReason: string | null = eligibility.ok ? null : eligibility.reason;
    if (eligibility.ok && committed) blockedReason = 'ALREADY_IN';
    else if (eligibility.ok && cooled) blockedReason = 'RELIABILITY_COOLDOWN';
    else if (eligibility.ok && seat.seats >= c.capacity && !offer)
      blockedReason = 'FULL_WAITLIST_OPEN';
    return {
      rsvp: f.rsvp,
      isHost: f.hostRole !== null,
      hostRole: f.hostRole,
      invitedBy: f.invitedById ? (cards.get(f.invitedById) ?? null) : null,
      offer: offer ? { expiresAt: offer.expiresAt.toISOString(), mode: offer.mode } : null,
      plusOne:
        plusOne && plusOne.memberId
          ? { kind: 'member', person: cards.get(plusOne.memberId) ?? null, claimed: true }
          : plusOne?.guestPending
            ? { kind: 'guest', person: null, claimed: false }
            : null,
      canRsvp: eligibility.ok && !committed && !cooled,
      cooldownUntil: cooled ? cooldown.toISOString() : null,
      blockedReason,
      canCheckIn: f.rsvp === 'going' && checkInWindowOpen(c, now),
      // Only the detail view looks up the viewer's checkout (one query per plan, not per feed card).
      payment: null,
    };
  }

  private async covers(cores: EventCore[]): Promise<Map<string, MediaVariants>> {
    const ids = [...new Set(cores.flatMap((c) => (c.coverMediaId ? [c.coverMediaId] : [])))];
    const rows = (await this.media.byIds(ids)).filter((m) => m.status === 'ready');
    const out = new Map<string, MediaVariants>();
    for (const m of rows) {
      const urls = await this.media.urlsFor(m.variantKeys);
      if (urls) out.set(m.id, urls);
    }
    return out;
  }

  private async openOffers(
    userId: string,
    eventIds: string[],
    now: Date,
  ): Promise<Map<string, { expiresAt: Date; mode: 'sequential' | 'broadcast' }>> {
    const rows = await this.db
      .select({
        eventId: waitlistOffers.eventId,
        expiresAt: waitlistOffers.expiresAt,
        mode: waitlistOffers.mode,
      })
      .from(waitlistOffers)
      .where(
        and(
          inArray(waitlistOffers.eventId, eventIds),
          eq(waitlistOffers.userId, userId),
          eq(waitlistOffers.status, 'open'),
          gt(waitlistOffers.expiresAt, now),
        ),
      );
    return new Map(rows.map((r) => [r.eventId, { expiresAt: r.expiresAt, mode: r.mode }]));
  }

  /** The viewer's +1 per event: a pending guest seat, or the member who came as their +1. */
  private async plusOnes(
    userId: string,
    eventIds: string[],
  ): Promise<Map<string, { guestPending: boolean; memberId: string | null }>> {
    const [mine, theirs] = await Promise.all([
      this.db
        .select({ eventId: rsvps.eventId, guestSeats: rsvps.guestSeats })
        .from(rsvps)
        .where(
          and(
            inArray(rsvps.eventId, eventIds),
            eq(rsvps.userId, userId),
            inArray(rsvps.status, ['going', 'checked_in']),
          ),
        ),
      this.db
        .select({ eventId: rsvps.eventId, memberId: rsvps.userId })
        .from(rsvps)
        .where(
          and(
            inArray(rsvps.eventId, eventIds),
            eq(rsvps.plusOneOf, userId),
            inArray(rsvps.status, ['going', 'checked_in']),
          ),
        ),
    ]);
    const out = new Map<string, { guestPending: boolean; memberId: string | null }>();
    for (const r of mine)
      if (r.guestSeats > 0) out.set(r.eventId, { guestPending: true, memberId: null });
    for (const r of theirs) out.set(r.eventId, { guestPending: false, memberId: r.memberId });
    return out;
  }

  /** Share of people holding a seat who come without squad already going and without a +1 (F-EVT-10). */
  async soloPercent(eventId: string): Promise<number> {
    const holders = await this.store.seatHolders(eventId);
    if (holders.length === 0) return 0;
    const isolated = await this.graph.isolatedAmong(holders.map((h) => h.userId));
    const broughtSomeone = new Set(holders.flatMap((h) => (h.plusOneOf ? [h.plusOneOf] : [])));
    const solo = holders.filter(
      (h) =>
        isolated.has(h.userId) &&
        h.plusOneOf === null &&
        h.guestSeats === 0 &&
        !broughtSomeone.has(h.userId),
    );
    return Math.round((solo.length / holders.length) * 100);
  }
}
