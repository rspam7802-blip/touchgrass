import { Inject, Injectable } from '@nestjs/common';
import {
  decodeCursor,
  encodeCursor,
  type JoinRequestList,
  type JoinRequestListQuery,
  type MyJoinRequest,
  TimeIdCursor,
} from '@touchgrass/shared';
import { and, asc, count, eq, gt, or } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { eventInvites, eventJoinRequests } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { EventAccessService } from './event-access.service.js';
import { EventViewService } from './event-view.service.js';
import { isLetIn } from './event.policy.js';

export const JOIN_REQUESTED_EVENT = 'event.join_requested';
export const JOIN_DECIDED_EVENT = 'event.join_decided';

const PAGE_SIZE = 30;

/**
 * Private plans (D-179). Anyone who can see a private plan may ask to join it; a host or co-host approves or
 * declines each person. Approval is an invite from that host: it lets the person pull up (seats and the
 * waitlist work as for any plan) and, once they are going, shows them the spot, the guest list and the chat.
 * A declined request cannot be made again.
 */
@Injectable()
export class EventJoinRequestsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: EventAccessService,
    private readonly view: EventViewService,
    private readonly people: PeopleService,
    private readonly outbox: OutboxService,
  ) {}

  /** Ask to join. Asking twice changes nothing; someone already let in has nothing to ask for. */
  async request(userId: string, eventId: string, now: Date = new Date()): Promise<MyJoinRequest> {
    const { core, ctx, facts } = await this.access.visibleOrThrow(userId, eventId);
    if (core.visibility !== 'approval')
      throw new AppError('NOT_ELIGIBLE', 'This plan does not take join requests', {
        reason: 'NOT_PRIVATE',
      });
    if (facts.hostRole) throw new AppError('CONFLICT', 'You are hosting this plan');
    if (core.status !== 'published' || now.getTime() >= core.endsAt.getTime())
      throw new AppError('EVENT_CLOSED', 'This plan is not taking requests');
    if (facts.joinRequest === 'declined')
      throw new AppError('NOT_ELIGIBLE', 'The host did not approve your request', {
        reason: 'JOIN_DECLINED',
      });
    if (!isLetIn(facts) && facts.joinRequest === null) {
      await this.db.transaction(async (tx) => {
        const rows = await tx
          .insert(eventJoinRequests)
          .values({ eventId, userId })
          .onConflictDoNothing()
          .returning({ userId: eventJoinRequests.userId });
        if (rows.length > 0)
          await this.outbox.add(tx, {
            aggregateType: 'event',
            aggregateId: eventId,
            type: JOIN_REQUESTED_EVENT,
            payload: { eventId, userId },
          });
      });
    }
    const fresh = await this.access.facts(ctx, eventId);
    return { status: fresh.joinRequest ?? null, event: await this.view.detail(ctx, core, fresh) };
  }

  /** Take back a request that has not been answered yet. */
  async withdraw(userId: string, eventId: string): Promise<void> {
    await this.access.visibleOrThrow(userId, eventId);
    await this.db
      .delete(eventJoinRequests)
      .where(
        and(
          eq(eventJoinRequests.eventId, eventId),
          eq(eventJoinRequests.userId, userId),
          eq(eventJoinRequests.status, 'pending'),
        ),
      );
  }

  /** People waiting for an answer, oldest first. Hosts only. */
  async pending(
    hostId: string,
    eventId: string,
    q: JoinRequestListQuery,
  ): Promise<JoinRequestList> {
    await this.access.requireHost(hostId, eventId);
    const after = q.cursor ? decodeCursor(q.cursor, TimeIdCursor) : null;
    const rows = await this.db
      .select()
      .from(eventJoinRequests)
      .where(
        and(
          eq(eventJoinRequests.eventId, eventId),
          eq(eventJoinRequests.status, 'pending'),
          after
            ? or(
                gt(eventJoinRequests.createdAt, new Date(after.t)),
                and(
                  eq(eventJoinRequests.createdAt, new Date(after.t)),
                  gt(eventJoinRequests.userId, after.id),
                ),
              )
            : undefined,
        ),
      )
      .orderBy(asc(eventJoinRequests.createdAt), asc(eventJoinRequests.userId))
      .limit(PAGE_SIZE + 1);
    const page = rows.slice(0, PAGE_SIZE);
    const cards = await this.people.cards(
      hostId,
      page.map((r) => r.userId),
    );
    const last = page[page.length - 1];
    return {
      // People the host has blocked (or who left) have no card and are not offered.
      items: page.flatMap((r) => {
        const person = cards.get(r.userId);
        return person ? [{ person, status: r.status, requestedAt: r.createdAt.toISOString() }] : [];
      }),
      nextCursor:
        rows.length > PAGE_SIZE && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.userId })
          : null,
    };
  }

  /** A host's answer. Approving invites the person, so they can pull up; declining is final. */
  async decide(hostId: string, eventId: string, userId: string, approve: boolean): Promise<void> {
    await this.access.requireHost(hostId, eventId, { roles: ['host', 'co_host'] });
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .update(eventJoinRequests)
        .set({
          status: approve ? 'approved' : 'declined',
          decidedBy: hostId,
          decidedAt: new Date(),
        })
        .where(
          and(
            eq(eventJoinRequests.eventId, eventId),
            eq(eventJoinRequests.userId, userId),
            eq(eventJoinRequests.status, 'pending'),
          ),
        )
        .returning({ userId: eventJoinRequests.userId });
      if (rows.length === 0) throw AppError.notFound('Join request');
      if (approve)
        await tx
          .insert(eventInvites)
          .values({ id: uuidv7(), eventId, inviteeUserId: userId, invitedBy: hostId })
          .onConflictDoNothing();
      await this.outbox.add(tx, {
        aggregateType: 'event',
        aggregateId: eventId,
        type: JOIN_DECIDED_EVENT,
        payload: { eventId, userId, approved: approve, byUserId: hostId },
      });
    });
  }

  /** How many people are waiting, for the host's badge. */
  async pendingCount(eventId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(eventJoinRequests)
      .where(and(eq(eventJoinRequests.eventId, eventId), eq(eventJoinRequests.status, 'pending')));
    return row?.n ?? 0;
  }

  /** Account export: the plans this person asked to join and how each request stands. */
  async exportFor(userId: string): Promise<{ eventId: string; status: string; at: string }[]> {
    const rows = await this.db
      .select()
      .from(eventJoinRequests)
      .where(eq(eventJoinRequests.userId, userId));
    return rows.map((r) => ({
      eventId: r.eventId,
      status: r.status,
      at: r.createdAt.toISOString(),
    }));
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(eventJoinRequests).where(eq(eventJoinRequests.userId, userId));
    await tx
      .update(eventJoinRequests)
      .set({ decidedBy: null })
      .where(eq(eventJoinRequests.decidedBy, userId));
  }
}
