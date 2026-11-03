import { Inject, Injectable } from '@nestjs/common';
import type { InviteeList } from '@touchgrass/shared';
import { and, eq, gt, inArray, isNotNull, or, isNull } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { pepperedHash, randomToken } from '../../common/auth/hashing.js';
import { AppError } from '../../common/errors/app-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { eventInvites, rsvps } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { EventAccessService, type EventViewerFacts } from './event-access.service.js';
import { holdsSeat } from './event.policy.js';
import { type EventCore, EventStore } from './event-store.service.js';

export const EVENT_INVITED_EVENT = 'event.invited';
const LINK_MAX_DAYS = 14;

/**
 * Who may invite: hosts always; people going may invite to public, balanced and friends-of-friends plans.
 * Invite-only and women-only plans are curated by their hosts (F-EVT-04, F-SAF-03).
 */
export function canInvite(
  core: Pick<EventCore, 'status' | 'visibility'>,
  facts: Pick<EventViewerFacts, 'hostRole' | 'rsvp'>,
): boolean {
  if (core.status !== 'published' && !(core.status === 'draft' && facts.hostRole)) return false;
  if (facts.hostRole) return true;
  return (
    holdsSeat(facts.rsvp) &&
    (core.visibility === 'public' ||
      core.visibility === 'balanced' ||
      core.visibility === 'friends_of_friends')
  );
}

/** Invite your squad (F-EVT-04) and "invited by" (shown as the earliest inviter). Share-link invites too. */
@Injectable()
export class EventInvitesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly access: EventAccessService,
    private readonly graph: SocialGraphService,
    private readonly people: PeopleService,
    private readonly outbox: OutboxService,
    private readonly store: EventStore,
  ) {}

  private hash(token: string): string {
    return pepperedHash(this.env.TOKEN_HASH_PEPPER, `event-invite:${token}`);
  }

  private async inviterAccess(userId: string, eventId: string) {
    const v = await this.access.visibleOrThrow(userId, eventId);
    if (!canInvite(v.core, v.facts))
      throw new AppError('FORBIDDEN', 'You cannot invite people to this plan');
    return v;
  }

  /** Invites squad members. Non-squad ids and people blocked with a host are skipped silently. */
  async invite(userId: string, eventId: string, userIds: string[]): Promise<{ invited: number }> {
    const { core, ctx, facts } = await this.inviterAccess(userId, eventId);
    const hostIds = facts.hosts.map((h) => h.userId);
    const candidates = [...new Set(userIds)].filter(
      (id) => ctx.squad.has(id) && id !== userId && !hostIds.includes(id),
    );
    const eligible: string[] = [];
    for (const id of candidates) {
      const blocked = await this.graph.blockedSet(id);
      if (!hostIds.some((h) => blocked.has(h))) eligible.push(id);
    }
    if (eligible.length === 0) return { invited: 0 };
    const inserted = await this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(eventInvites)
        .values(
          eligible.map((inviteeUserId) => ({
            id: uuidv7(),
            eventId,
            inviteeUserId,
            invitedBy: userId,
          })),
        )
        .onConflictDoNothing()
        .returning({ inviteeUserId: eventInvites.inviteeUserId });
      const ids = rows.flatMap((r) => (r.inviteeUserId ? [r.inviteeUserId] : []));
      if (ids.length > 0 && core.status === 'published') {
        await this.outbox.add(tx, {
          aggregateType: 'event',
          aggregateId: eventId,
          type: EVENT_INVITED_EVENT,
          payload: { eventId, inviterId: userId, inviteeIds: ids },
        });
      }
      return ids;
    });
    return { invited: inserted.length };
  }

  /**
   * Invites people on behalf of a module that already decided they belong (crew members to a crew session,
   * voters to the plan their vote locked). No squad requirement and no notification of its own; people
   * blocked with a host are still skipped.
   */
  async grantInvites(eventId: string, inviterId: string, userIds: string[]): Promise<number> {
    const hosts = await this.store.hosts(eventId);
    const hostIds = hosts.map((h) => h.userId);
    const eligible: string[] = [];
    for (const id of [...new Set(userIds)]) {
      if (hostIds.includes(id)) continue;
      const blocked = await this.graph.blockedSet(id);
      if (!hostIds.some((h) => blocked.has(h))) eligible.push(id);
    }
    if (eligible.length === 0) return 0;
    const rows = await this.db
      .insert(eventInvites)
      .values(
        eligible.map((inviteeUserId) => ({
          id: uuidv7(),
          eventId,
          inviteeUserId,
          invitedBy: inviterId,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: eventInvites.id });
    return rows.length;
  }

  /** A shareable link that lets anyone who opens it see (and pull up to) the plan; they're "invited by" you. */
  async createLink(
    userId: string,
    eventId: string,
    now: Date = new Date(),
  ): Promise<{ url: string; expiresAt: string }> {
    const { core } = await this.inviterAccess(userId, eventId);
    const token = randomToken(24);
    const expiresAt = new Date(
      Math.min(core.endsAt.getTime(), now.getTime() + LINK_MAX_DAYS * 86_400_000),
    );
    await this.db.insert(eventInvites).values({
      id: uuidv7(),
      eventId,
      inviteeUserId: null,
      invitedBy: userId,
      linkTokenHash: this.hash(token),
      expiresAt,
    });
    return {
      url: `${this.env.WEB_PUBLIC_URL}/e/${core.slug}?i=${token}`,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Opening an invite link records a personal invite from the link's creator. Unknown, expired, or other
   * plans' tokens do nothing (the caller then gets the normal visibility answer).
   */
  async redeemLink(
    userId: string,
    eventId: string,
    token: string,
    now: Date = new Date(),
  ): Promise<void> {
    const [link] = await this.db
      .select({ invitedBy: eventInvites.invitedBy })
      .from(eventInvites)
      .where(
        and(
          eq(eventInvites.eventId, eventId),
          eq(eventInvites.linkTokenHash, this.hash(token)),
          or(isNull(eventInvites.expiresAt), gt(eventInvites.expiresAt, now)),
        ),
      )
      .limit(1);
    if (!link || link.invitedBy === userId) return;
    if ((await this.graph.blockedSet(userId)).has(link.invitedBy)) return;
    await this.db
      .insert(eventInvites)
      .values({ id: uuidv7(), eventId, inviteeUserId: userId, invitedBy: link.invitedBy })
      .onConflictDoNothing();
  }

  /** My squad with whether each person is already invited / on the plan (invite picker). */
  async invitees(userId: string, eventId: string): Promise<InviteeList> {
    const { ctx } = await this.inviterAccess(userId, eventId);
    const squad = [...ctx.squad];
    if (squad.length === 0) return { items: [] };
    const [invited, onPlan, cards] = await Promise.all([
      this.db
        .selectDistinct({ id: eventInvites.inviteeUserId })
        .from(eventInvites)
        .where(
          and(
            eq(eventInvites.eventId, eventId),
            isNotNull(eventInvites.inviteeUserId),
            inArray(eventInvites.inviteeUserId, squad),
          ),
        ),
      this.db
        .select({ id: rsvps.userId, status: rsvps.status })
        .from(rsvps)
        .where(and(eq(rsvps.eventId, eventId), inArray(rsvps.userId, squad))),
      this.people.list(userId, squad),
    ]);
    const invitedSet = new Set(invited.map((r) => r.id));
    const status = new Map(onPlan.map((r) => [r.id, r.status]));
    return {
      items: cards
        .map((person) => ({
          person,
          invited: invitedSet.has(person.id),
          rsvp: status.get(person.id) ?? null,
        }))
        .sort((a, b) => a.person.displayName.localeCompare(b.person.displayName)),
    };
  }
}
