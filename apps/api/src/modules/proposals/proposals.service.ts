import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type AddProposalOptionBody,
  type CreateProposalBody,
  CreateEventBody,
  EventWhere,
  LIMITS,
  type LockProposalBody,
  type PersonCard,
  pickWinner,
  type ProposalDetail,
  type ProposalList,
  type ProposalOption,
  type ProposalVoteBody,
  type ModerationPreview,
} from '@touchgrass/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import {
  planProposals,
  proposalInvitees,
  proposalOptions,
  proposalVotes,
} from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { withRedisLock } from '../../infra/redis/redis-lock.js';
import { REDIS } from '../../infra/redis/redis.module.js';
import { EventInvitesService } from '../events/event-invites.service.js';
import { EventsService } from '../events/events.service.js';
import { type AfterCommit, GONE } from '../moderation/moderation-targets.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { SanctionsReader } from '../moderation/sanctions-reader.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { UsersService } from '../users/users.service.js';
import { VenuesService } from '../venues/venues.service.js';
import {
  deadlineBlock,
  isVotingOpen,
  lockBlock,
  type ProposalReason,
  timeOptionBlock,
} from './proposals.policy.js';

export const PROPOSAL_INVITED_EVENT = 'proposal.invited';
export const PROPOSAL_LOCKED_EVENT = 'proposal.locked';

type ProposalRow = typeof planProposals.$inferSelect;
type OptionRow = typeof proposalOptions.$inferSelect;
const P = LIMITS.proposals;
const VOTER_SAMPLE = 5;
/** Settled proposals stay in the list this long. */
const RECENT_MS = 7 * 86_400_000;

function denied(reason: ProposalReason): AppError {
  if (reason === 'NOT_HOST')
    return new AppError('FORBIDDEN', 'Only the organiser can do that', { reason });
  if (reason === 'TOO_MANY_OPTIONS' || reason === 'BAD_DEADLINE' || reason === 'TIME_PASSED')
    return new AppError('VALIDATION_FAILED', 'Not a valid choice', { reason });
  return new AppError('NOT_ELIGIBLE', 'Voting is closed', { reason });
}

/**
 * Collaborative plans (F-ENG-03): invited squad members suggest times, places and activities and vote; the
 * organiser locks it, or the worker locks the most-voted options at the deadline, into a real invite-only plan.
 */
@Injectable()
export class ProposalsService {
  private readonly logger = new Logger(ProposalsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly outbox: OutboxService,
    private readonly users: UsersService,
    private readonly people: PeopleService,
    private readonly graph: SocialGraphService,
    private readonly venues: VenuesService,
    private readonly events: EventsService,
    private readonly invites: EventInvitesService,
    private readonly moderation: ModerationService,
    private readonly sanctions: SanctionsReader,
    private readonly profiles: ProfilesService,
  ) {}

  // ---------- access ----------

  private async participants(proposalId: string, db: Database | Tx = this.db): Promise<string[]> {
    const rows = await db
      .select({ userId: proposalInvitees.userId })
      .from(proposalInvitees)
      .where(eq(proposalInvitees.proposalId, proposalId));
    return rows.map((r) => r.userId);
  }

  /** Organiser or invitee, and not blocked with the organiser; anyone else gets a 404. */
  private async open(
    userId: string,
    proposalId: string,
    db: Database | Tx = this.db,
  ): Promise<{ p: ProposalRow; invitees: string[] }> {
    const [p] = await db.select().from(planProposals).where(eq(planProposals.id, proposalId));
    if (!p) throw AppError.notFound('Plan');
    const invitees = await this.participants(proposalId, db);
    if (p.creatorId !== userId) {
      if (!invitees.includes(userId) || p.heldAt) throw AppError.notFound('Plan');
      if (await this.graph.isBlockedEitherWay(userId, p.creatorId)) throw AppError.notFound('Plan');
    }
    return { p, invitees };
  }

  // ---------- create ----------

  async create(
    userId: string,
    body: CreateProposalBody,
    now: Date = new Date(),
  ): Promise<ProposalDetail> {
    const deadline = new Date(body.deadline);
    const block = deadlineBlock(deadline, now);
    if (block) throw denied(block);
    const [squad, blocked, user] = await Promise.all([
      this.graph.friendIds(userId),
      this.graph.blockedSet(userId),
      this.users.findById(userId),
    ]);
    const squadSet = new Set(squad);
    const invitees = [...new Set(body.inviteeIds)].filter(
      (id) => id !== userId && squadSet.has(id) && !blocked.has(id),
    );
    await this.sanctions.assertCanPost(userId, now);
    const screen = this.moderation.screen(body.title, body.description);
    const resolved = await Promise.all(body.options.map((o) => this.resolveOption(o, now)));
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.insert(planProposals).values({
        id,
        creatorId: userId,
        cityId: user?.cityId ?? null,
        title: body.title,
        description: body.description,
        categoryInterestId: body.categoryInterestId,
        deadline,
        autoLock: body.autoLock,
        capacity: body.capacity,
        heldAt: screen.flagged ? now : null,
      });
      await this.moderation.flagText(
        { type: 'proposal', id, cityId: user?.cityId ?? null },
        screen,
        tx,
      );
      if (invitees.length > 0)
        await tx
          .insert(proposalInvitees)
          .values(invitees.map((u) => ({ proposalId: id, userId: u })));
      for (const o of resolved)
        await tx
          .insert(proposalOptions)
          .values({ id: uuidv7(), proposalId: id, createdBy: userId, ...o });
      // Invitees hear about a held vote only once it's released.
      if (invitees.length > 0 && !screen.flagged)
        await this.outbox.add(tx, {
          aggregateType: 'proposal',
          aggregateId: id,
          type: PROPOSAL_INVITED_EVENT,
          payload: { proposalId: id, creatorId: userId, userIds: invitees },
        });
    });
    return this.detail(userId, id);
  }

  private async resolveOption(
    body: AddProposalOptionBody,
    now: Date,
  ): Promise<Omit<typeof proposalOptions.$inferInsert, 'id' | 'proposalId' | 'createdBy'>> {
    // Activity labels are short and shown to everyone voting, so flagged ones are refused, not held.
    if (body.kind === 'activity' && this.moderation.screen(body.label).flagged)
      throw new AppError('VALIDATION_FAILED', 'Pick different words', [
        { path: 'label', message: 'Pick different words', code: 'custom' },
      ]);
    switch (body.kind) {
      case 'time': {
        const startsAt = new Date(body.startsAt);
        const block = timeOptionBlock(startsAt, now);
        if (block) throw denied(block);
        return {
          kind: 'time',
          startsAt,
          endsAt: new Date(startsAt.getTime() + body.durationMinutes * 60_000),
        };
      }
      case 'place': {
        if ('venueId' in body.where) {
          const venue = await this.venues.byId(body.where.venueId);
          if (!venue) throw AppError.notFound('Venue');
          return {
            kind: 'place',
            label: venue.name,
            address: venue.address,
            locationWhere: body.where,
          };
        }
        return {
          kind: 'place',
          label: body.where.placeName ?? body.where.address,
          address: body.where.address,
          locationWhere: body.where,
        };
      }
      case 'activity':
        return { kind: 'activity', label: body.label, interestId: body.interestId };
    }
  }

  // ---------- read ----------

  async detail(viewerId: string, proposalId: string): Promise<ProposalDetail> {
    const { p, invitees } = await this.open(viewerId, proposalId);
    const options = await this.db
      .select()
      .from(proposalOptions)
      .where(eq(proposalOptions.proposalId, proposalId))
      .orderBy(asc(proposalOptions.createdAt), asc(proposalOptions.id));
    const optionIds = options.map((o) => o.id);
    const votes =
      optionIds.length === 0
        ? []
        : await this.db
            .select()
            .from(proposalVotes)
            .where(inArray(proposalVotes.optionId, optionIds))
            .orderBy(asc(proposalVotes.createdAt));
    const peopleIds = [
      p.creatorId,
      ...invitees,
      ...votes.map((v) => v.userId),
      ...options.flatMap((o) => (o.createdBy ? [o.createdBy] : [])),
    ];
    const cards = await this.people.cards(viewerId, peopleIds, { includeSelf: true });
    const creator = cards.get(p.creatorId);
    if (!creator) throw AppError.notFound('Plan');
    const byOption = new Map<string, string[]>();
    for (const v of votes)
      byOption.set(v.optionId, [...(byOption.get(v.optionId) ?? []), v.userId]);
    const view = (o: OptionRow): ProposalOption => {
      const voters = byOption.get(o.id) ?? [];
      return {
        id: o.id,
        kind: o.kind,
        label: o.label,
        startsAt: o.startsAt?.toISOString() ?? null,
        endsAt: o.endsAt?.toISOString() ?? null,
        address: o.address,
        interestId: o.interestId,
        votes: voters.length,
        voters: voters
          .flatMap((id) => {
            const c = cards.get(id);
            return c ? [c] : [];
          })
          .slice(0, VOTER_SAMPLE),
        mine: voters.includes(viewerId),
        createdBy: o.createdBy ? (cards.get(o.createdBy) ?? null) : null,
      };
    };
    const has = (k: OptionRow['kind']) => options.some((o) => o.kind === k);
    return {
      id: p.id,
      title: p.title,
      description: p.description,
      status: p.status,
      deadline: p.deadline.toISOString(),
      autoLock: p.autoLock,
      capacity: p.capacity,
      categoryInterestId: p.categoryInterestId,
      creator,
      invitees: invitees.flatMap((id) => {
        const c = cards.get(id);
        return c ? [c] : ([] as PersonCard[]);
      }),
      options: options.map(view),
      eventId: p.eventId,
      viewerIsCreator: p.creatorId === viewerId,
      canLock: p.creatorId === viewerId && p.status === 'open' && has('time') && has('place'),
      cancelledReason: p.cancelledReason,
      held: p.heldAt !== null,
    };
  }

  async list(viewerId: string, now: Date = new Date()): Promise<ProposalList> {
    const rows = await this.db
      .selectDistinct({ p: planProposals })
      .from(planProposals)
      .leftJoin(proposalInvitees, eq(proposalInvitees.proposalId, planProposals.id))
      .where(
        and(
          or(
            eq(planProposals.creatorId, viewerId),
            and(eq(proposalInvitees.userId, viewerId), isNull(planProposals.heldAt)),
          ),
          or(
            eq(planProposals.status, 'open'),
            gte(planProposals.updatedAt, new Date(now.getTime() - RECENT_MS)),
          ),
        ),
      )
      .orderBy(desc(planProposals.deadline))
      .limit(50);
    const blocked = await this.graph.blockedSet(viewerId);
    const visible = rows.map((r) => r.p).filter((p) => !blocked.has(p.creatorId));
    const ids = visible.map((p) => p.id);
    const [cards, counts] = await Promise.all([
      this.people.cards(
        viewerId,
        visible.map((p) => p.creatorId),
        { includeSelf: true },
      ),
      ids.length === 0
        ? Promise.resolve([])
        : this.db
            .select({ id: proposalOptions.proposalId, n: count() })
            .from(proposalOptions)
            .where(inArray(proposalOptions.proposalId, ids))
            .groupBy(proposalOptions.proposalId),
    ]);
    const optionCounts = new Map(counts.map((c) => [c.id, c.n]));
    const rank = (s: ProposalRow['status']) => (s === 'open' ? 0 : 1);
    return {
      items: visible
        .sort(
          (a, b) => rank(a.status) - rank(b.status) || a.deadline.getTime() - b.deadline.getTime(),
        )
        .flatMap((p) => {
          const creator = cards.get(p.creatorId);
          return creator
            ? [
                {
                  id: p.id,
                  title: p.title,
                  status: p.status,
                  deadline: p.deadline.toISOString(),
                  creator,
                  optionCount: optionCounts.get(p.id) ?? 0,
                  eventId: p.eventId,
                  held: p.heldAt !== null,
                },
              ]
            : [];
        }),
    };
  }

  // ---------- suggest and vote ----------

  async addOption(
    userId: string,
    proposalId: string,
    body: AddProposalOptionBody,
    now: Date = new Date(),
  ): Promise<ProposalDetail> {
    const { p } = await this.open(userId, proposalId);
    if (!isVotingOpen(p, now)) throw denied('PROPOSAL_CLOSED');
    const values = await this.resolveOption(body, now);
    await this.db.transaction(async (tx) => {
      // Serialise suggestions on this proposal so the option cap holds under concurrency.
      await tx
        .select({ id: planProposals.id })
        .from(planProposals)
        .where(eq(planProposals.id, proposalId))
        .for('update');
      const n = await tx.$count(proposalOptions, eq(proposalOptions.proposalId, proposalId));
      if (n >= P.maxOptions) throw denied('TOO_MANY_OPTIONS');
      await tx
        .insert(proposalOptions)
        .values({ id: uuidv7(), proposalId, createdBy: userId, ...values });
    });
    return this.detail(userId, proposalId);
  }

  async vote(
    userId: string,
    proposalId: string,
    body: ProposalVoteBody,
    now: Date = new Date(),
  ): Promise<ProposalDetail> {
    const { p } = await this.open(userId, proposalId);
    if (!isVotingOpen(p, now)) throw denied('PROPOSAL_CLOSED');
    const [option] = await this.db
      .select({ id: proposalOptions.id })
      .from(proposalOptions)
      .where(
        and(eq(proposalOptions.id, body.optionId), eq(proposalOptions.proposalId, proposalId)),
      );
    if (!option) throw AppError.notFound('Option');
    if (body.vote)
      await this.db
        .insert(proposalVotes)
        .values({ optionId: option.id, userId })
        .onConflictDoNothing();
    else
      await this.db
        .delete(proposalVotes)
        .where(and(eq(proposalVotes.optionId, option.id), eq(proposalVotes.userId, userId)));
    return this.detail(userId, proposalId);
  }

  // ---------- lock ----------

  async lock(
    userId: string,
    proposalId: string,
    body: LockProposalBody,
    now: Date = new Date(),
  ): Promise<ProposalDetail> {
    const { p } = await this.open(userId, proposalId);
    const block = lockBlock(p, userId);
    if (block) throw denied(block);
    const options = await this.db
      .select()
      .from(proposalOptions)
      .where(eq(proposalOptions.proposalId, proposalId));
    const pick = (id: string | null, kind: OptionRow['kind']) =>
      id === null ? null : (options.find((o) => o.id === id && o.kind === kind) ?? undefined);
    const time = pick(body.timeOptionId, 'time');
    const place = pick(body.placeOptionId, 'place');
    const activity = pick(body.activityOptionId, 'activity');
    if (!time || !place || activity === undefined) throw denied('NEEDS_TIME_AND_PLACE');
    if (time.startsAt && time.startsAt <= now) throw denied('TIME_PASSED');
    await this.lockWith(proposalId, time, place, activity, now);
    return this.detail(userId, proposalId);
  }

  /** Creates the plan and marks the proposal locked; serialised so a manual and an automatic lock can't both win. */
  private async lockWith(
    proposalId: string,
    time: OptionRow,
    place: OptionRow,
    activity: OptionRow | null,
    now: Date,
  ): Promise<string | null> {
    return withRedisLock(
      this.redis,
      `proposal:${proposalId}`,
      async () => {
        const [p] = await this.db
          .select()
          .from(planProposals)
          .where(eq(planProposals.id, proposalId));
        if (!p || p.status !== 'open') throw denied('PROPOSAL_CLOSED');
        const category = activity?.interestId ?? p.categoryInterestId;
        if (!category || !time.startsAt || !time.endsAt || !place.locationWhere)
          throw denied('NEEDS_TIME_AND_PLACE');
        const body = CreateEventBody.parse({
          title: activity
            ? `${p.title} · ${activity.label}`.slice(0, LIMITS.event.titleMaxLength)
            : p.title,
          description: p.description,
          categoryInterestId: category,
          where: EventWhere.parse(place.locationWhere),
          startsAt: time.startsAt.toISOString(),
          endsAt: time.endsAt.toISOString(),
          capacity: p.capacity,
          visibility: 'invite_only',
          publish: true,
        });
        const event = await this.events.create(p.creatorId, [], body, now);
        const invitees = await this.participants(proposalId);
        await this.invites.grantInvites(event.id, p.creatorId, invitees);
        await this.db.transaction(async (tx) => {
          await tx
            .update(planProposals)
            .set({ status: 'locked', eventId: event.id, lockedAt: now })
            .where(eq(planProposals.id, proposalId));
          await this.outbox.add(tx, {
            aggregateType: 'proposal',
            aggregateId: proposalId,
            type: PROPOSAL_LOCKED_EVENT,
            payload: { proposalId, eventId: event.id, title: p.title, userIds: invitees },
          });
        });
        return event.id;
      },
      { ttlMs: 30_000, waitMs: 10_000 },
    );
  }

  async cancel(userId: string, proposalId: string): Promise<ProposalDetail> {
    const { p } = await this.open(userId, proposalId);
    const block = lockBlock(p, userId);
    if (block) throw denied(block);
    await this.db
      .update(planProposals)
      .set({ status: 'cancelled', cancelledReason: 'BY_CREATOR' })
      .where(and(eq(planProposals.id, proposalId), eq(planProposals.status, 'open')));
    return this.detail(userId, proposalId);
  }

  /**
   * Worker: at the deadline, auto-lock proposals lock to the most-voted time (still in the future) and place,
   * plus the top activity if any; without both, the vote closes without a plan.
   */
  async lockDue(now: Date = new Date()): Promise<number> {
    const due = await this.db
      .select()
      .from(planProposals)
      .where(
        and(
          eq(planProposals.status, 'open'),
          eq(planProposals.autoLock, true),
          lte(planProposals.deadline, now),
        ),
      )
      .limit(100);
    let locked = 0;
    for (const p of due) {
      const options = await this.db
        .select({ o: proposalOptions, votes: sql<number>`count(${proposalVotes.userId})::int` })
        .from(proposalOptions)
        .leftJoin(proposalVotes, eq(proposalVotes.optionId, proposalOptions.id))
        .where(eq(proposalOptions.proposalId, p.id))
        .groupBy(proposalOptions.id);
      const ranked = options.map((r) => ({ ...r.o, votes: r.votes }));
      const time = pickWinner(
        ranked.filter((o) => o.kind === 'time' && o.startsAt !== null && o.startsAt > now),
      );
      const place = pickWinner(ranked.filter((o) => o.kind === 'place'));
      const activityPick = pickWinner(ranked.filter((o) => o.kind === 'activity' && o.votes > 0));
      if (!time || !place) {
        await this.db
          .update(planProposals)
          .set({ status: 'cancelled', cancelledReason: 'NO_OPTIONS' })
          .where(and(eq(planProposals.id, p.id), eq(planProposals.status, 'open')));
        continue;
      }
      try {
        if (await this.lockWith(p.id, time, place, activityPick, now)) locked += 1;
      } catch (err) {
        this.logger.warn(`Proposal ${p.id} could not lock: ${String(err)}`);
        await this.db
          .update(planProposals)
          .set({ status: 'cancelled', cancelledReason: 'LOCK_FAILED' })
          .where(and(eq(planProposals.id, p.id), eq(planProposals.status, 'open')));
      }
    }
    return locked;
  }

  async titleOf(proposalId: string): Promise<string | null> {
    const [p] = await this.db
      .select({ title: planProposals.title })
      .from(planProposals)
      .where(eq(planProposals.id, proposalId));
    return p?.title ?? null;
  }

  // ---------- account data ----------

  // ---------- moderation (F-SAF-06) ----------

  async moderationPreview(proposalId: string): Promise<ModerationPreview> {
    const [p] = await this.db.select().from(planProposals).where(eq(planProposals.id, proposalId));
    if (!p || p.status === 'cancelled') return GONE;
    const names = await this.profiles.displayNames([p.creatorId]);
    return {
      title: p.title,
      text: p.description || null,
      image: null,
      owner: { id: p.creatorId, displayName: names.get(p.creatorId) ?? '' },
      gone: false,
    };
  }

  /** Releases a held vote and invites its people, as creating it would have. */
  async releaseHeld(proposalId: string, tx: Tx): Promise<AfterCommit> {
    const [p] = await tx
      .update(planProposals)
      .set({ heldAt: null })
      .where(and(eq(planProposals.id, proposalId), isNotNull(planProposals.heldAt)))
      .returning();
    if (!p || p.status !== 'open') return undefined;
    const invitees = await this.participants(proposalId, tx);
    if (invitees.length > 0)
      await this.outbox.add(tx, {
        aggregateType: 'proposal',
        aggregateId: proposalId,
        type: PROPOSAL_INVITED_EVENT,
        payload: { proposalId, creatorId: p.creatorId, userIds: invitees },
      });
    return undefined;
  }

  /** Takes a vote down: cancelled, and hidden from invitees. */
  async removeForModeration(proposalId: string, tx: Tx): Promise<AfterCommit> {
    await tx
      .update(planProposals)
      .set({
        status: sql`CASE WHEN ${planProposals.status} = 'open' THEN 'cancelled' ELSE ${planProposals.status} END`,
        cancelledReason: 'Removed by the TouchGrass team',
        heldAt: new Date(),
      })
      .where(eq(planProposals.id, proposalId));
    return undefined;
  }

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const created = await this.db
      .select()
      .from(planProposals)
      .where(eq(planProposals.creatorId, userId));
    const votes = await this.db
      .select()
      .from(proposalVotes)
      .where(eq(proposalVotes.userId, userId));
    return {
      proposals: created.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        deadline: p.deadline.toISOString(),
        eventId: p.eventId,
      })),
      proposalVotes: votes.map((v) => ({ optionId: v.optionId, at: v.createdAt.toISOString() })),
    };
  }

  /** Their proposals go (with options and votes); elsewhere their votes and invites go, suggestions stay unsigned. */
  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(planProposals).where(eq(planProposals.creatorId, userId));
    await tx.delete(proposalVotes).where(eq(proposalVotes.userId, userId));
    await tx.delete(proposalInvitees).where(eq(proposalInvitees.userId, userId));
    await tx
      .update(proposalOptions)
      .set({ createdBy: null })
      .where(eq(proposalOptions.createdBy, userId));
  }
}
