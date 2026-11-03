import { Inject, Injectable } from '@nestjs/common';
import type { Gender, HostRole } from '@touchgrass/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { eventHosts, eventInvites, rsvps } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import type { Relationship } from '../profiles/profile.policy.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { UsersService } from '../users/users.service.js';
import { canViewEvent, type ViewerFacts } from './event.policy.js';
import { type EventCore, EventStore } from './event-store.service.js';

/** Viewer-level facts that do not depend on the event. */
export interface ViewerContext {
  userId: string;
  gender: Gender | null;
  verified: boolean;
  blocked: Set<string>;
  squad: Set<string>;
}

export interface EventViewerFacts extends ViewerFacts {
  hosts: { userId: string; role: HostRole }[];
  /** Earliest person who invited the viewer, if any. */
  invitedById: string | null;
}

/**
 * Builds the facts the event policies need, for one event or a page of them, with a bounded number of
 * queries (no per-event N+1). This module owns event_hosts / event_invites / rsvps; the graph and profiles
 * are asked through their services.
 */
@Injectable()
export class EventAccessService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly store: EventStore,
    private readonly graph: SocialGraphService,
    private readonly profiles: ProfilesService,
    private readonly users: UsersService,
  ) {}

  async context(userId: string, db: DbOrTx = this.db): Promise<ViewerContext> {
    const [gender, verified, blocked, squad] = await Promise.all([
      this.profiles.genderOf(userId, db),
      this.users.verifiedIds([userId]),
      this.graph.blockedSet(userId),
      this.graph.friendIds(userId, this.db),
    ]);
    return { userId, gender, verified: verified.has(userId), blocked, squad: new Set(squad) };
  }

  async factsFor(
    ctx: ViewerContext,
    eventIds: string[],
    db: DbOrTx = this.db,
  ): Promise<Map<string, EventViewerFacts>> {
    const out = new Map<string, EventViewerFacts>();
    if (eventIds.length === 0) return out;
    const [hostRows, inviteRows, rsvpRows] = await Promise.all([
      db
        .select({ eventId: eventHosts.eventId, userId: eventHosts.userId, role: eventHosts.role })
        .from(eventHosts)
        .where(inArray(eventHosts.eventId, eventIds)),
      db
        .select({ eventId: eventInvites.eventId, invitedBy: eventInvites.invitedBy })
        .from(eventInvites)
        .where(
          and(inArray(eventInvites.eventId, eventIds), eq(eventInvites.inviteeUserId, ctx.userId)),
        )
        .orderBy(asc(eventInvites.createdAt)),
      db
        .select({ eventId: rsvps.eventId, status: rsvps.status })
        .from(rsvps)
        .where(and(inArray(rsvps.eventId, eventIds), eq(rsvps.userId, ctx.userId))),
    ]);
    const allHostIds = [...new Set(hostRows.map((h) => h.userId))].filter(
      (id) => id !== ctx.userId && !ctx.squad.has(id),
    );
    const mutuals = await this.graph.mutualCounts(ctx.userId, allHostIds);
    const relationTo = (hostId: string): Relationship => {
      if (hostId === ctx.userId) return 'self';
      if (ctx.squad.has(hostId)) return 'squad';
      return (mutuals.get(hostId) ?? 0) > 0 ? 'friend_of_friend' : 'none';
    };
    const RANK: Record<Relationship, number> = { self: 3, squad: 2, friend_of_friend: 1, none: 0 };
    for (const eventId of eventIds) {
      const hosts = hostRows
        .filter((h) => h.eventId === eventId)
        .map((h) => ({ userId: h.userId, role: h.role }));
      const best = hosts.reduce<Relationship>((acc, h) => {
        const r = relationTo(h.userId);
        return RANK[r] > RANK[acc] ? r : acc;
      }, 'none');
      const invite = inviteRows.find((i) => i.eventId === eventId);
      const rsvp = rsvpRows.find((r) => r.eventId === eventId);
      out.set(eventId, {
        hosts,
        hostRole: hosts.find((h) => h.userId === ctx.userId)?.role ?? null,
        invited: invite !== undefined,
        invitedById: invite?.invitedBy ?? null,
        rsvp: rsvp?.status ?? null,
        relationshipToHosts: best === 'self' ? 'squad' : best,
        blockedWithHost: hosts.some((h) => ctx.blocked.has(h.userId)),
        gender: ctx.gender,
        verified: ctx.verified,
      });
    }
    return out;
  }

  async facts(
    ctx: ViewerContext,
    eventId: string,
    db: DbOrTx = this.db,
  ): Promise<EventViewerFacts> {
    const f = (await this.factsFor(ctx, [eventId], db)).get(eventId);
    if (!f) throw AppError.notFound('Event');
    return f;
  }

  /**
   * Loads an event the viewer may see, or 404s. Invisible events are indistinguishable from missing ones,
   * so their existence never leaks (F-EVT-03, F-SAF-03).
   */
  async visibleOrThrow(
    viewerId: string,
    eventId: string,
  ): Promise<{ core: EventCore; ctx: ViewerContext; facts: EventViewerFacts }> {
    const core = await this.store.core(eventId);
    if (!core) throw AppError.notFound('Event');
    const ctx = await this.context(viewerId);
    const facts = await this.facts(ctx, eventId);
    if (!canViewEvent(facts, core)) throw AppError.notFound('Event');
    return { core, ctx, facts };
  }

  /** Host-side access: any host role, or one of `roles`. Non-hosts who cannot see the event get a 404. */
  async requireHost(
    userId: string,
    eventId: string,
    opts: { roles?: HostRole[] } = {},
  ): Promise<EventCore> {
    const core = await this.store.core(eventId);
    if (!core) throw AppError.notFound('Event');
    const hosts = await this.store.hosts(eventId);
    const mine = hosts.find((h) => h.userId === userId);
    if (!mine) {
      const ctx = await this.context(userId);
      const facts = await this.facts(ctx, eventId);
      if (!canViewEvent(facts, core)) throw AppError.notFound('Event');
      throw new AppError('FORBIDDEN', 'Only hosts can do that');
    }
    if (opts.roles && !opts.roles.includes(mine.role))
      throw new AppError('FORBIDDEN', 'Your host role cannot do that');
    return core;
  }
}
