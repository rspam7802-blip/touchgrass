import { Injectable } from '@nestjs/common';
import type { SearchQuery, SearchResponse } from '@touchgrass/shared';
import { CrewsService } from '../crews/crews.service.js';
import { EventAccessService } from '../events/event-access.service.js';
import { canViewEvent } from '../events/event.policy.js';
import { EventSearchService } from '../events/event-search.service.js';
import { EventStore } from '../events/event-store.service.js';
import { EventViewService } from '../events/event-view.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { profileAccess } from '../profiles/profile.policy.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { UsersService } from '../users/users.service.js';
import { VenuesService } from '../venues/venues.service.js';
import { DiscoveryService } from './discovery.service.js';

/** How many raw matches each section considers before visibility filtering trims them. */
const OVERSCAN = 5;

/**
 * Search (F-DSC-09) over plans, people and places with full-text + trigram matching. Every section applies
 * the same rules as browsing: plans through the visibility policy and mystery-safe serializer, people only
 * when their profile settings allow the viewer the full profile, blocked people never; crews only when
 * the viewer is a member or the crew is open to requests (invite-only crews stay hidden).
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly eventSearch: EventSearchService,
    private readonly store: EventStore,
    private readonly access: EventAccessService,
    private readonly view: EventViewService,
    private readonly profiles: ProfilesService,
    private readonly users: UsersService,
    private readonly graph: SocialGraphService,
    private readonly people: PeopleService,
    private readonly venues: VenuesService,
    private readonly discovery: DiscoveryService,
    private readonly crews: CrewsService,
  ) {}

  async search(userId: string, q: SearchQuery): Promise<SearchResponse> {
    const want = (t: 'events' | 'people' | 'venues' | 'crews'): boolean =>
      q.type === 'all' || q.type === t;
    const [events, people, venues, crews] = await Promise.all([
      want('events') ? this.events(userId, q.q, q.limit) : Promise.resolve([]),
      want('people') ? this.peopleMatching(userId, q.q, q.limit) : Promise.resolve([]),
      want('venues') ? this.places(userId, q) : Promise.resolve([]),
      want('crews') ? this.crews.searchByName(userId, q.q, q.limit) : Promise.resolve([]),
    ]);
    return { events, people, venues, crews };
  }

  private async events(
    userId: string,
    text: string,
    limit: number,
  ): Promise<SearchResponse['events']> {
    const ids = await this.eventSearch.searchText(text, limit * OVERSCAN);
    if (ids.length === 0) return [];
    const ctx = await this.access.context(userId);
    const [cores, facts] = await Promise.all([
      this.store.coresByIds(ids),
      this.access.factsFor(ctx, ids),
    ]);
    const byId = new Map(cores.map((c) => [c.id, c]));
    const visible = ids
      .flatMap((id) => {
        const c = byId.get(id);
        const f = facts.get(id);
        return c && f && canViewEvent(f, c) ? [c] : [];
      })
      .slice(0, limit);
    return this.view.summaries(ctx, visible, facts);
  }

  private async peopleMatching(
    userId: string,
    text: string,
    limit: number,
  ): Promise<SearchResponse['people']> {
    const ids = (await this.profiles.searchByName(text, limit * OVERSCAN)).filter(
      (id) => id !== userId,
    );
    if (ids.length === 0) return [];
    const [blocked, squad, mutuals, visibility, active] = await Promise.all([
      this.graph.blockedSet(userId),
      this.graph.friendIds(userId),
      this.graph.mutualCounts(userId, ids),
      this.profiles.visibilities(ids),
      this.users.activeIds(ids),
    ]);
    const squadSet = new Set(squad);
    const allowed = ids.filter((id) => {
      const v = visibility.get(id);
      if (!v) return false;
      const relationship = squadSet.has(id)
        ? 'squad'
        : (mutuals.get(id) ?? 0) > 0
          ? 'friend_of_friend'
          : 'none';
      return (
        profileAccess({
          relationship,
          blocked: blocked.has(id),
          targetStatus: active.has(id) ? 'active' : 'suspended',
          visibility: v,
        }) === 'full'
      );
    });
    return this.people.list(userId, allowed.slice(0, limit));
  }

  private async places(userId: string, q: SearchQuery): Promise<SearchResponse['venues']> {
    const { center } = await this.discovery.viewerCenter(userId, q.lat, q.lng);
    return this.venues.toDto(await this.venues.search(q.q, center, q.limit));
  }
}
