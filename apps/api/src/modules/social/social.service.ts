import { Injectable } from '@nestjs/common';
import {
  type ContactMatch,
  decodeCursor,
  encodeCursor,
  type FriendRequest,
  LIMITS,
  type PersonList,
  type Suggestion,
  TimeIdCursor,
} from '@touchgrass/shared';
import { PeopleService } from '../profiles/people.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { UsersService } from '../users/users.service.js';
import { SocialGraphService } from './graph/social-graph.service.js';
import { SharedEventsReader } from './shared-events.port.js';
import {
  isMeaningful,
  scoreSuggestion,
  type SuggestionSignals,
  suggestionReasons,
} from './suggestions.scoring.js';

/** Application layer for the squad: lists, requests, contact matching and suggestions (F-SOC-01..03). */
@Injectable()
export class SocialService {
  constructor(
    private readonly graph: SocialGraphService,
    private readonly people: PeopleService,
    private readonly profiles: ProfilesService,
    private readonly users: UsersService,
    private readonly sharedEvents: SharedEventsReader,
  ) {}

  async squad(userId: string, cursor: string | undefined, limit: number): Promise<PersonList> {
    const after = cursor ? decodeCursor(cursor, TimeIdCursor) : null;
    const page = await this.graph.squadPage(userId, after, limit + 1);
    const visible = page.slice(0, limit);
    const last = visible[visible.length - 1];
    return {
      items: await this.people.list(
        userId,
        visible.map((p) => p.id),
      ),
      nextCursor:
        page.length > limit && last
          ? encodeCursor({ t: last.since.toISOString(), id: last.id })
          : null,
    };
  }

  async requests(userId: string): Promise<FriendRequest[]> {
    const [incoming, outgoing] = await Promise.all([
      this.graph.pendingRequests(userId, 'incoming'),
      this.graph.pendingRequests(userId, 'outgoing'),
    ]);
    const cards = await this.people.cards(
      userId,
      [...incoming, ...outgoing].map((r) => r.id),
    );
    const build = (
      rows: { id: string; createdAt: Date }[],
      direction: 'incoming' | 'outgoing',
    ): FriendRequest[] =>
      rows.flatMap((r) => {
        const person = cards.get(r.id);
        return person ? [{ person, direction, createdAt: r.createdAt.toISOString() }] : [];
      });
    return [...build(incoming, 'incoming'), ...build(outgoing, 'outgoing')];
  }

  /**
   * Matches hashed contacts to members who allow contact discovery, and remembers the hashes
   * (replacing the previous upload) for "people you know" suggestions.
   */
  async matchContacts(userId: string, hashes: string[]): Promise<ContactMatch[]> {
    await this.graph.replaceContactHashes(userId, hashes);
    const byHash = await this.users.activeIdsByPhoneHashes([...new Set(hashes)]);
    byHash.forEach((id, hash) => {
      if (id === userId) byHash.delete(hash);
    });
    const discoverable = await this.profiles.withPrivacyFlag(
      [...byHash.values()],
      'discoverableByContacts',
    );
    const cards = await this.people.cards(
      userId,
      [...byHash.values()].filter((id) => discoverable.has(id)),
    );
    const out: ContactMatch[] = [];
    for (const [hash, id] of byHash) {
      const person = cards.get(id);
      if (person)
        out.push({ hash, person, relationship: await this.graph.relationshipStatus(userId, id) });
    }
    return out.sort((a, b) => a.person.displayName.localeCompare(b.person.displayName));
  }

  /** People you might know: mutual friends, contacts (both directions), shared events and shared interests. */
  async suggestions(
    userId: string,
    limit: number = LIMITS.social.suggestionLimit,
  ): Promise<Suggestion[]> {
    const pool = limit * 5;
    const [
      fof,
      interestMatches,
      coAttendees,
      myHashes,
      myHash,
      friends,
      pending,
      dismissed,
      blocked,
    ] = await Promise.all([
      this.graph.friendsOfFriends(userId, pool),
      this.profiles.sharingInterests(userId, pool),
      this.sharedEvents.coAttendees(userId, pool),
      this.graph.myContactHashes(userId),
      this.users.phoneHashOf(userId),
      this.graph.friendIds(userId),
      this.graph.pendingWith(userId),
      this.graph.dismissed(userId),
      this.graph.blockedSet(userId),
    ]);
    const contactIds = new Set((await this.users.activeIdsByPhoneHashes(myHashes)).values());
    if (myHash) for (const id of await this.graph.usersWithContact(myHash)) contactIds.add(id);

    const excluded = new Set([userId, ...friends, ...pending, ...dismissed, ...blocked]);
    const candidates = [
      ...new Set([
        ...fof.map((f) => f.id),
        ...interestMatches.map((i) => i.id),
        ...coAttendees.map((c) => c.id),
        ...contactIds,
      ]),
    ].filter((id) => !excluded.has(id));
    if (candidates.length === 0) return [];

    const discoverable = await this.profiles.withPrivacyFlag(
      [...contactIds],
      'discoverableByContacts',
    );
    const [mutuals, shared, sharedEvents, cards] = await Promise.all([
      this.graph.mutualCounts(userId, candidates),
      this.profiles.sharedInterestCounts(userId, candidates),
      this.sharedEvents.sharedEventCounts(userId, candidates),
      this.people.cards(userId, candidates),
    ]);
    const scored: Suggestion[] = [];
    for (const id of candidates) {
      const person = cards.get(id);
      if (!person) continue;
      const signals: SuggestionSignals = {
        mutualFriends: mutuals.get(id) ?? 0,
        inContacts: contactIds.has(id) && discoverable.has(id),
        sharedInterests: shared.get(id) ?? 0,
        sharedEvents: sharedEvents.get(id) ?? 0,
      };
      if (!isMeaningful(signals)) continue;
      scored.push({
        person,
        reasons: suggestionReasons(signals),
        sharedInterestCount: signals.sharedInterests,
        score: scoreSuggestion(signals),
      });
    }
    return scored
      .sort((a, b) => b.score - a.score || a.person.id.localeCompare(b.person.id))
      .slice(0, limit);
  }
}
