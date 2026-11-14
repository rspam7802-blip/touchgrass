import { Inject, Injectable } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  type Feed,
  type FeedClickBody,
  type FeedItem,
  type FeedQuery,
  type FeedReason,
  type GeoPoint,
  LIMITS,
  type MapQuery,
  type MapResponse,
  type PersonCard,
  type WeatherNow,
} from '@touchgrass/shared';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { z } from 'zod';
import type { HourlyForecast } from '../../adapters/weather/weather.port.js';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { discoveryClicks, discoveryImpressions } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { eq } from 'drizzle-orm';
import { CitiesService } from '../cities/cities.service.js';
import { InterestsService } from '../interests/interests.service.js';
import {
  EventAccessService,
  type EventViewerFacts,
  type ViewerContext,
} from '../events/event-access.service.js';
import { canViewEvent } from '../events/event.policy.js';
import {
  type CandidateArea,
  type CandidateFilters,
  type CandidateRow,
  EventSearchService,
} from '../events/event-search.service.js';
import { type EventCore, EventStore } from '../events/event-store.service.js';
import { EventViewService } from '../events/event-view.service.js';
import { MYSTERY_AREA_RADIUS_M } from '../events/mystery.js';
import { PeopleService } from '../profiles/people.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { AdminEventsService } from '../events/admin-events.service.js';
import { RankingWeightsService } from './ranking-weights.service.js';
import { clusterPoints, scoreEvent, timeWindow, weatherFit } from './ranking.js';
import { HostRatingReader } from '../feedback/host-rating-reader.js';
import { WeatherService } from './weather.service.js';

const D = LIMITS.discovery;
const FOF_LIMIT = 500;
const SNAPSHOT_KEY = (userId: string, requestId: string): string =>
  `feed:v1:snap:${userId}:${requestId}`;
/** A repeat of the same first-page request within this window reuses the ranked snapshot (cached feed). */
const LAST_KEY = (userId: string, hash: string): string => `feed:v1:last:${userId}:${hash}`;
/** Bumped whenever a plan is published, changed or cancelled (DiscoveryHandlers); part of the reuse key. */
export const FEED_EPOCH_KEY = 'feed:v1:epoch';
const LAST_TTL_SECONDS = 60;

const FeedCursor = z.object({ r: z.uuid(), o: z.number().int().min(0) });

interface SnapshotEntry {
  id: string;
  score: number;
  reasons: FeedReason[];
  distanceMeters: number;
}
interface Snapshot {
  center: GeoPoint;
  weather: WeatherNow | null;
  entries: SnapshotEntry[];
}

/**
 * Discovery (F-DSC-01..08): ranked, explainable, cached feed with cursor paging over a short-lived ranked
 * snapshot; filters; near-you ordering; who's-going previews and "via" mutuals; weather-aware boosts; the map.
 * Every event shown goes through the events module's visibility policy and mystery-safe serializer.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly search: EventSearchService,
    private readonly store: EventStore,
    private readonly access: EventAccessService,
    private readonly view: EventViewService,
    private readonly graph: SocialGraphService,
    private readonly people: PeopleService,
    private readonly profiles: ProfilesService,
    private readonly cities: CitiesService,
    private readonly interests: InterestsService,
    private readonly weather: WeatherService,
    private readonly hostRatings: HostRatingReader,
    private readonly weights: RankingWeightsService,
    private readonly adminEvents: AdminEventsService,
  ) {}

  // ---------- feed ----------

  async feed(userId: string, q: FeedQuery, now: Date = new Date()): Promise<Feed> {
    let requestId: string;
    let offset = 0;
    let snapshot: Snapshot | null;
    // Built while ranking a fresh snapshot; reused by hydrate instead of loading it twice.
    let viewerCtx: ViewerContext | undefined;
    if (q.cursor) {
      const c = decodeCursor(q.cursor, FeedCursor);
      requestId = c.r;
      offset = c.o;
      snapshot = await this.loadSnapshot(userId, requestId);
      // The ranked list moved on; the client starts again from the top (keeps paging consistent).
      if (!snapshot) throw new AppError('INVALID_CURSOR', 'The feed was refreshed; reload it');
    } else {
      // Only reuse a snapshot ranked since the last plan change, so a new plan shows up straight away.
      const epoch = (await this.redis.get(FEED_EPOCH_KEY)) ?? '0';
      const hash = `${filterHash(q)}:${epoch}`;
      const reused = await this.redis.get(LAST_KEY(userId, hash));
      snapshot = reused ? await this.loadSnapshot(userId, reused) : null;
      if (reused && snapshot) requestId = reused;
      else {
        requestId = uuidv7();
        const built = await this.buildSnapshot(userId, q, now);
        snapshot = built.snapshot;
        viewerCtx = built.ctx;
        await this.redis
          .multi()
          .set(SNAPSHOT_KEY(userId, requestId), JSON.stringify(snapshot), 'PX', D.snapshotTtlMs)
          .set(LAST_KEY(userId, hash), requestId, 'EX', LAST_TTL_SECONDS)
          .exec();
      }
    }
    const pageEntries = snapshot.entries.slice(offset, offset + q.limit);
    const items = await this.hydrate(userId, pageEntries, now, viewerCtx);
    await this.logImpressions(userId, requestId, offset, pageEntries, items);
    const nextOffset = offset + q.limit;
    return {
      items,
      nextCursor:
        nextOffset < snapshot.entries.length ? encodeCursor({ r: requestId, o: nextOffset }) : null,
      requestId,
      center: snapshot.center,
      weather: snapshot.weather,
    };
  }

  private async loadSnapshot(userId: string, requestId: string): Promise<Snapshot | null> {
    const raw = await this.redis.get(SNAPSHOT_KEY(userId, requestId));
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  }

  /** Where "near me" is: the device location, else the home neighbourhood, else the city centre. */
  async viewerCenter(
    userId: string,
    lat?: number,
    lng?: number,
  ): Promise<{ center: GeoPoint; cityId: string | null }> {
    const profile = await this.profiles.get(userId);
    const cityId = profile?.cityId ?? null;
    if (lat !== undefined && lng !== undefined) return { center: { lat, lng }, cityId };
    const hood = profile?.neighbourhoodId
      ? await this.cities.centroid(profile.neighbourhoodId)
      : null;
    if (hood) return { center: hood, cityId };
    const city = cityId ? await this.cities.centre(cityId) : null;
    if (city) return { center: city, cityId };
    const [first] = await this.cities.launchedCityCentres();
    if (!first) throw new AppError('NOT_FOUND', 'No launched city');
    return { center: first.centre, cityId: first.id };
  }

  private async viewer(userId: string): Promise<{ ctx: ViewerContext; fof: string[] }> {
    const ctx = await this.access.context(userId);
    const fof = (await this.graph.friendsOfFriends(userId, FOF_LIMIT)).map((f) => f.id);
    return { ctx, fof };
  }

  /** Candidates the viewer may see, with their cores and facts (visibility re-checked with the policy). */
  private async visibleCandidates(
    ctx: ViewerContext,
    fof: string[],
    area: CandidateArea,
    filters: CandidateFilters,
    order: 'soonest' | 'nearest',
    limit: number,
  ): Promise<{
    rows: CandidateRow[];
    cores: Map<string, EventCore>;
    facts: Map<string, EventViewerFacts>;
  }> {
    const rows = await this.search.candidates(
      {
        userId: ctx.userId,
        squadIds: [...ctx.squad],
        reachableIds: [...ctx.squad, ...fof],
        verifiedWoman: ctx.verified && ctx.gender === 'woman',
        verifiedMan: ctx.verified && ctx.gender === 'man',
      },
      area,
      filters,
      order,
      limit,
    );
    const ids = rows.map((r) => r.id);
    const [coreList, facts] = await Promise.all([
      this.store.coresByIds(ids),
      this.access.factsFor(ctx, ids),
    ]);
    const cores = new Map(coreList.map((c) => [c.id, c]));
    const visible = rows.filter((r) => {
      const c = cores.get(r.id);
      const f = facts.get(r.id);
      return c !== undefined && f !== undefined && canViewEvent(f, c);
    });
    return { rows: visible, cores, facts };
  }

  private filtersFrom(q: FeedQuery | MapQuery, now: Date): CandidateFilters {
    const window = timeWindow(q.when, now, D.horizonDays);
    return {
      from: q.from ? new Date(q.from) : window.from,
      to: q.to ? new Date(q.to) : window.to,
      categoryId: q.categoryId,
      interestIds: q.interestIds,
      vibeTagIds: q.vibeTagIds,
      maxPricePaise: q.free ? 0 : q.maxPricePaise,
      smallGroup: q.smallGroup,
      soloFriendly: q.soloFriendly,
      womenOnly: q.womenOnly,
      squadGoing: q.squadGoing,
      indoor: q.indoor,
      stepFree: q.stepFree,
      accessibleRestroom: q.accessibleRestroom,
      quietSpace: q.quietSpace,
    };
  }

  private async buildSnapshot(
    userId: string,
    q: FeedQuery,
    now: Date,
  ): Promise<{ snapshot: Snapshot; ctx: ViewerContext }> {
    const [{ ctx, fof }, where] = await Promise.all([
      this.viewer(userId),
      this.viewerCenter(userId, q.lat, q.lng),
    ]);
    const { rows, cores } = await this.visibleCandidates(
      ctx,
      fof,
      { kind: 'radius', center: where.center, meters: q.radiusKm * 1000 },
      this.filtersFrom(q, now),
      q.sort === 'nearest' ? 'nearest' : 'soonest',
      D.candidatePool,
    );
    const ids = rows.map((r) => r.id);
    const cityIds = [
      ...new Set(
        [...rows.map((r) => cores.get(r.id)?.cityId), where.cityId].filter((x): x is string => !!x),
      ),
    ];
    const [taxonomy, holders, myInterests, myVibes, forecasts, weights, featured] =
      await Promise.all([
        this.search.taxonomyMany(ids),
        this.search.seatHoldersMany(ids),
        this.profiles.interestIdsOf(userId),
        this.profiles.vibeTagIdsOf(userId),
        Promise.all(cityIds.map(async (id) => [id, await this.weather.forecast(id)] as const)),
        this.weights.current(),
        this.adminEvents.featuredIn(cityIds, now),
      ]);
    const forecastBy = new Map<string, HourlyForecast[] | null>(forecasts);
    const hostRatings = await this.hostRatings.summaries([
      ...new Set([...cores.values()].map((c) => c.creatorUserId)),
    ]);
    const interestSet = new Set(myInterests);
    const vibeSet = new Set(myVibes);
    const fofSet = new Set(fof);

    const entries: (SnapshotEntry & { startsAt: number; featuredRank: number | null })[] = rows.map(
      (r) => {
        const core = cores.get(r.id) as EventCore;
        const tax = taxonomy.get(r.id) ?? { interestIds: [], vibeTagIds: [] };
        const going = holders.get(r.id) ?? [];
        const eventInterests = new Set([
          ...(core.categoryInterestId ? [core.categoryInterestId] : []),
          ...tax.interestIds,
        ]);
        const w = WeatherService.atTime(forecastBy.get(core.cityId) ?? null, core.startsAt);
        const ranked = scoreEvent(
          {
            interestMatches: [...eventInterests].filter((i) => interestSet.has(i)).length,
            vibeMatches: tax.vibeTagIds.filter((v) => vibeSet.has(v)).length,
            squadGoing: going.filter((u) => ctx.squad.has(u)).length,
            friendsOfFriendsGoing: going.filter((u) => fofSet.has(u)).length,
            distanceMeters: r.distanceMeters,
            hoursUntilStart: (core.startsAt.getTime() - now.getTime()) / 3_600_000,
            fillRatio: core.capacity > 0 ? Math.min(1, going.length / core.capacity) : 0,
            soloFriendly: core.soloFriendly,
            viewerSquadSize: ctx.squad.size,
            weatherFit: weatherFit(w, core.indoor).fit,
            hoursSincePublished: r.publishedAt
              ? (now.getTime() - r.publishedAt.getTime()) / 3_600_000
              : 0,
            hostRating: hostRatings.get(core.creatorUserId)?.average ?? null,
          },
          weights,
        );
        // Curators pin plans to the top of their city's feed (F-GRW-03); it is said, not hidden.
        const rank = featured.get(r.id) ?? null;
        return {
          id: r.id,
          score: ranked.score,
          reasons:
            rank === null ? ranked.reasons : (['featured', ...ranked.reasons] as FeedReason[]),
          distanceMeters: r.distanceMeters,
          startsAt: core.startsAt.getTime(),
          featuredRank: rank,
        };
      },
    );
    // KNN order is spherical; re-sort on the reported (spheroidal) distance so "nearest" reads correctly.
    if (q.sort === 'nearest')
      entries.sort((a, b) => a.distanceMeters - b.distanceMeters || (a.id < b.id ? -1 : 1));
    if (q.sort === 'recommended')
      entries.sort(
        (a, b) =>
          (a.featuredRank ?? Infinity) - (b.featuredRank ?? Infinity) ||
          b.score - a.score ||
          a.startsAt - b.startsAt ||
          (a.id < b.id ? -1 : 1),
      );
    const weatherNow = where.cityId
      ? WeatherService.atTime(forecastBy.get(where.cityId) ?? null, now)
      : null;
    return {
      snapshot: {
        center: where.center,
        weather: weatherNow,
        entries: entries.map(({ startsAt: _s, featuredRank: _f, ...e }) => e),
      },
      ctx,
    };
  }

  /** Turns a page of snapshot entries into feed items; plans that changed visibility since ranking are dropped. */
  private async hydrate(
    userId: string,
    entries: SnapshotEntry[],
    now: Date,
    known?: ViewerContext,
  ): Promise<FeedItem[]> {
    if (entries.length === 0) return [];
    const ctx = known ?? (await this.access.context(userId));
    const ids = entries.map((e) => e.id);
    const [coreList, facts] = await Promise.all([
      this.store.coresByIds(ids),
      this.access.factsFor(ctx, ids),
    ]);
    const cores = new Map(coreList.map((c) => [c.id, c]));
    const visible = entries.flatMap((e) => {
      const c = cores.get(e.id);
      const f = facts.get(e.id);
      // Plans the viewer hosts or joined stay listed (everyone sees every plan on Explore and the map).
      return c && f && c.status === 'published' && canViewEvent(f, c)
        ? [{ entry: e, core: c, facts: f }]
        : [];
    });
    const summaries = await this.view.summaries(
      ctx,
      visible.map((v) => v.core),
      facts,
      now,
    );
    const byId = new Map(summaries.map((s) => [s.id, s]));
    const [previews, vias, forecasts] = await Promise.all([
      this.previews(
        ctx,
        visible.map((v) => v.core.id),
      ),
      this.vias(
        ctx,
        visible.map((v) => ({ id: v.core.id, facts: v.facts })),
      ),
      Promise.all(
        [...new Set(visible.map((v) => v.core.cityId))].map(
          async (id) => [id, await this.weather.forecast(id)] as const,
        ),
      ),
    ]);
    const forecastBy = new Map(forecasts);
    return visible.flatMap(({ entry, core }) => {
      const summary = byId.get(core.id);
      if (!summary) return [];
      const w = WeatherService.atTime(forecastBy.get(core.cityId) ?? null, core.startsAt);
      return [
        {
          ...summary,
          preview: { people: previews.get(core.id) ?? [], total: summary.goingCount },
          via: vias.get(core.id) ?? null,
          reasons: entry.reasons,
          distanceMeters: entry.distanceMeters,
          weather: w ? { ...w, advice: weatherFit(w, core.indoor).advice } : null,
        },
      ];
    });
  }

  /**
   * "Who's pulling up" (F-DSC-05): up to three faces — squad first, then the people you share most mutuals
   * with. Anyone who hid themselves from who's-going lists, or is blocked, never appears.
   */
  private async previews(
    ctx: ViewerContext,
    eventIds: string[],
  ): Promise<Map<string, PersonCard[]>> {
    const holders = await this.search.seatHoldersMany(eventIds);
    const everyone = [...new Set([...holders.values()].flat())].filter(
      (u) => u !== ctx.userId && !ctx.blocked.has(u),
    );
    const [shown, mutuals] = await Promise.all([
      this.profiles.withPrivacyFlag(everyone, 'showInWhoIsGoing'),
      this.graph.mutualCounts(ctx.userId, everyone),
    ]);
    const picks = new Map<string, string[]>();
    for (const [eventId, users] of holders) {
      const ranked = users
        .filter((u) => shown.has(u))
        .sort(
          (a, b) =>
            Number(ctx.squad.has(b)) - Number(ctx.squad.has(a)) ||
            (mutuals.get(b) ?? 0) - (mutuals.get(a) ?? 0),
        );
      picks.set(eventId, ranked.slice(0, D.previewSize));
    }
    const cards = await this.people.cards(ctx.userId, [...picks.values()].flat());
    return new Map(
      [...picks].map(([eventId, ids]) => [
        eventId,
        ids.flatMap((id) => (cards.has(id) ? [cards.get(id) as PersonCard] : [])),
      ]),
    );
  }

  /** "via [mutual]" (F-DSC-06): for plans hosted by friends of friends, the squad member who connects you. */
  private async vias(
    ctx: ViewerContext,
    events: { id: string; facts: EventViewerFacts }[],
  ): Promise<Map<string, PersonCard>> {
    const viaIds = new Map<string, string>();
    for (const e of events) {
      if (e.facts.relationshipToHosts !== 'friend_of_friend') continue;
      for (const h of e.facts.hosts) {
        const [mutual] = await this.graph.mutualFriendIds(ctx.userId, h.userId, 1);
        if (mutual) {
          viaIds.set(e.id, mutual);
          break;
        }
      }
    }
    const cards = await this.people.cards(ctx.userId, [...viaIds.values()]);
    return new Map(
      [...viaIds].flatMap(([eventId, id]) =>
        cards.has(id) ? [[eventId, cards.get(id) as PersonCard] as const] : [],
      ),
    );
  }

  private async logImpressions(
    userId: string,
    requestId: string,
    offset: number,
    entries: SnapshotEntry[],
    served: FeedItem[],
  ): Promise<void> {
    const servedIds = new Set(served.map((s) => s.id));
    const rows = entries
      .map((e, i) => ({ e, position: offset + i }))
      .filter(({ e }) => servedIds.has(e.id))
      .map(({ e, position }) => ({
        id: uuidv7(),
        requestId,
        userId,
        eventId: e.id,
        position,
        score: e.score,
        reasons: e.reasons,
      }));
    if (rows.length > 0) await this.db.insert(discoveryImpressions).values(rows);
  }

  /** Click logging (F-DSC-07). Only events actually served in that snapshot count. */
  async click(userId: string, body: FeedClickBody): Promise<void> {
    const snapshot = await this.loadSnapshot(userId, body.requestId);
    if (snapshot && !snapshot.entries.some((e) => e.id === body.eventId))
      throw AppError.notFound('Feed item');
    await this.db.insert(discoveryClicks).values({
      id: uuidv7(),
      requestId: body.requestId,
      userId,
      eventId: body.eventId,
      position: body.position,
    });
  }

  // ---------- map (F-DSC-03) ----------

  async map(userId: string, q: MapQuery, now: Date = new Date()): Promise<MapResponse> {
    const [minLng, minLat, maxLng, maxLat] = q.bbox;
    const { ctx, fof } = await this.viewer(userId);
    const center = { lat: (minLat + maxLat) / 2, lng: (minLng + maxLng) / 2 };
    const { rows, cores } = await this.visibleCandidates(
      ctx,
      fof,
      { kind: 'bbox', minLng, minLat, maxLng, maxLat, center },
      this.filtersFrom(q, now),
      'soonest',
      D.mapMaxPins + 1,
    );
    const truncated = rows.length > D.mapMaxPins;
    const kept = rows.slice(0, D.mapMaxPins);
    const categoryIds = [
      ...new Set(
        kept.flatMap((r) =>
          cores.get(r.id)?.categoryInterestId
            ? [cores.get(r.id)?.categoryInterestId as string]
            : [],
        ),
      ),
    ];
    const emojis = new Map(
      (await this.interests.interestsByIds(categoryIds)).map((i) => [i.id, i.emoji]),
    );
    const { singles, clusters } = clusterPoints(kept, q.zoom);
    return {
      pins: singles.flatMap((r) => {
        const c = cores.get(r.id);
        if (!c) return [];
        return [
          {
            id: c.id,
            slug: c.slug,
            title: c.title,
            // The public centre: exact for normal plans, fuzzed for mystery plans (drawn as a circle).
            center: { lat: r.lat, lng: r.lng },
            radiusMeters: c.mystery ? MYSTERY_AREA_RADIUS_M : 0,
            mystery: c.mystery,
            startsAt: c.startsAt.toISOString(),
            emoji: c.categoryInterestId ? (emojis.get(c.categoryInterestId) ?? null) : null,
          },
        ];
      }),
      clusters: clusters.map((c) => ({ center: { lat: c.lat, lng: c.lng }, count: c.count })),
      truncated,
    };
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const clicks = await this.db
      .select({ eventId: discoveryClicks.eventId, clickedAt: discoveryClicks.clickedAt })
      .from(discoveryClicks)
      .where(eq(discoveryClicks.userId, userId));
    const impressions = await this.db.$count(
      discoveryImpressions,
      eq(discoveryImpressions.userId, userId),
    );
    return {
      feedImpressions: impressions,
      feedClicks: clicks.map((c) => ({ ...c, clickedAt: c.clickedAt.toISOString() })),
    };
  }

  async eraseFor(userId: string, tx: DbOrTx): Promise<void> {
    await tx.delete(discoveryImpressions).where(eq(discoveryImpressions.userId, userId));
    await tx.delete(discoveryClicks).where(eq(discoveryClicks.userId, userId));
  }
}

/** Stable hash of everything that shapes the ranking (not the cursor/page size). */
export function filterHash(q: FeedQuery): string {
  const { cursor: _c, limit: _l, lat, lng, ...rest } = q;
  // Location is rounded to ~100 m so a jittery GPS still reuses the cached snapshot.
  const rounded =
    lat !== undefined && lng !== undefined
      ? { lat: Math.round(lat * 1000), lng: Math.round(lng * 1000) }
      : null;
  const canonical = JSON.stringify(
    Object.entries({ ...rest, rounded }).sort(([a], [b]) => (a < b ? -1 : 1)),
  );
  return createHash('sha256').update(canonical).digest('hex').slice(0, 24);
}
