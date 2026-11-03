import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminChallenge,
  ChallengeCriteria,
  type ChallengeView,
  type JoinChallengeBody,
  LocalizedText,
  type UpsertChallengeBody,
} from '@touchgrass/shared';
import { and, asc, count, eq, gt, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { badges, challengeParticipants, challenges } from '../../infra/database/schema/index.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { CrewsService } from '../crews/crews.service.js';
import { EventSearchService } from '../events/event-search.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { GamificationService } from './gamification.service.js';

export const CHALLENGE_COMPLETED_EVENT = 'challenge.completed';

type ChallengeRow = typeof challenges.$inferSelect;
type ParticipantRow = typeof challengeParticipants.$inferSelect;
/** Ended challenges stay visible for a week so people see how they did. */
const RECENT_MS = 7 * 86_400_000;

export interface QualifyingCheckIn {
  userId: string;
  eventId: string;
  venueId: string | null;
  neighbourhoodId: string | null;
  categoryId: string | null;
}

/**
 * Progress towards a challenge from the team's check-ins in the window (pure, unit-tested):
 * category filter, "new places" (not visited by that person before the start), "with squad" (decided by the
 * caller), then distinct places or plain check-ins, capped at the target.
 */
/** Where a check-in happened, for "distinct"/"new places": the venue, or the neighbourhood for pinned spots. */
export function placeKey(
  c: QualifyingCheckIn,
  field: 'venueId' | 'neighbourhoodId',
): string | null {
  if (field === 'neighbourhoodId') return c.neighbourhoodId ? `hood:${c.neighbourhoodId}` : null;
  if (c.venueId) return `venue:${c.venueId}`;
  return c.neighbourhoodId ? `hood:${c.neighbourhoodId}` : null;
}

export function challengeProgress(
  criteria: ChallengeCriteria,
  during: QualifyingCheckIn[],
  before: QualifyingCheckIn[],
  withSquad: (c: QualifyingCheckIn) => boolean,
): number {
  const field = criteria.distinct ?? 'venueId';
  const seenBefore = new Set(
    before.flatMap((b) => {
      const k = placeKey(b, field);
      return k ? [`${b.userId}:${k}`] : [];
    }),
  );
  const qualifying = during.filter((c) => {
    const k = placeKey(c, field);
    return (
      (!criteria.categoryInterestId || c.categoryId === criteria.categoryInterestId) &&
      (!criteria.newPlacesOnly || (k !== null && !seenBefore.has(`${c.userId}:${k}`))) &&
      (!criteria.withSquad || withSquad(c))
    );
  });
  const n = criteria.distinct
    ? new Set(
        qualifying.flatMap((c) => {
          const k = placeKey(c, field);
          return k ? [k] : [];
        }),
      ).size
    : // One outing counts once, however many of the team were there.
      new Set(qualifying.map((c) => c.eventId)).size;
  return Math.min(n, criteria.target);
}

export function challengeState(
  c: Pick<ChallengeRow, 'startsAt' | 'endsAt'>,
  now: Date,
): ChallengeView['state'] {
  if (now < c.startsAt) return 'upcoming';
  return now < c.endsAt ? 'active' : 'ended';
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Themed challenges (F-GAM-03): solo or crew teams, progress from check-ins, a badge on completion. */
@Injectable()
export class ChallengesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly gamification: GamificationService,
    private readonly crews: CrewsService,
    private readonly graph: SocialGraphService,
    private readonly search: EventSearchService,
  ) {}

  private criteria(row: ChallengeRow): ChallengeCriteria {
    return ChallengeCriteria.parse(row.criteria);
  }

  // ---------- people ----------

  async list(userId: string, now: Date = new Date()): Promise<ChallengeView[]> {
    const rows = await this.db
      .select()
      .from(challenges)
      .where(
        and(
          eq(challenges.active, true),
          gt(challenges.endsAt, new Date(now.getTime() - RECENT_MS)),
        ),
      )
      .orderBy(asc(challenges.endsAt));
    const ids = rows.map((r) => r.id);
    const mine =
      ids.length === 0
        ? []
        : await this.db
            .select()
            .from(challengeParticipants)
            .where(
              and(
                inArray(challengeParticipants.challengeId, ids),
                eq(challengeParticipants.userId, userId),
              ),
            );
    const byChallenge = new Map(mine.map((m) => [m.challengeId, m]));
    const rewardIds = rows.flatMap((r) => (r.rewardBadgeId ? [r.rewardBadgeId] : []));
    const crewIds = mine.flatMap((m) => (m.crewId ? [m.crewId] : []));
    const [rewards, crewNames] = await Promise.all([
      this.gamification.badgesByIds(rewardIds),
      this.crews.names(crewIds),
    ]);
    return rows.map((r) => {
      const p = byChallenge.get(r.id);
      return {
        id: r.id,
        title: LocalizedText.parse(r.title),
        description: LocalizedText.parse(r.description),
        emoji: r.emoji,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        mode: r.mode,
        target: this.criteria(r).target,
        rewardBadge: r.rewardBadgeId ? (rewards.get(r.rewardBadgeId) ?? null) : null,
        state: challengeState(r, now),
        joined: Boolean(p),
        team: p?.crewId ? { crewId: p.crewId, crewName: crewNames.get(p.crewId) ?? '' } : null,
        progress: p?.progress ?? 0,
        completedAt: p?.completedAt?.toISOString() ?? null,
      };
    });
  }

  async join(
    userId: string,
    challengeId: string,
    body: JoinChallengeBody,
    now: Date = new Date(),
  ): Promise<ChallengeView[]> {
    const [c] = await this.db.select().from(challenges).where(eq(challenges.id, challengeId));
    if (!c?.active) throw AppError.notFound('Challenge');
    if (challengeState(c, now) === 'ended')
      throw new AppError('NOT_ELIGIBLE', 'This challenge has ended', { reason: 'CHALLENGE_OVER' });
    let crewId: string | null = null;
    if (c.mode === 'group') {
      const mine = await this.crews.activeCrewsOf(userId);
      if (!body.crewId || !mine.some((m) => m.id === body.crewId))
        throw new AppError('NOT_ELIGIBLE', 'Join with one of your crews', { reason: 'NEEDS_CREW' });
      crewId = body.crewId;
    }
    await this.db
      .insert(challengeParticipants)
      .values({ challengeId, userId, crewId, joinedAt: now })
      .onConflictDoNothing();
    if (challengeState(c, now) === 'active') await this.recompute(challengeId, userId, now);
    return this.list(userId, now);
  }

  // ---------- progress ----------

  private async teamOf(
    c: ChallengeRow,
    p: ParticipantRow,
  ): Promise<{ members: string[]; rows: ParticipantRow[] }> {
    if (c.mode === 'solo' || !p.crewId) return { members: [p.userId], rows: [p] };
    const [members, rows] = await Promise.all([
      this.crews.activeMemberIds(p.crewId),
      this.db
        .select()
        .from(challengeParticipants)
        .where(
          and(
            eq(challengeParticipants.challengeId, c.id),
            eq(challengeParticipants.crewId, p.crewId),
          ),
        ),
    ]);
    return { members, rows };
  }

  /** Recomputes one participant's (team's) progress and completes it when the target is reached. */
  async recompute(challengeId: string, userId: string, now: Date = new Date()): Promise<number> {
    const [c] = await this.db.select().from(challenges).where(eq(challenges.id, challengeId));
    const [p] = await this.db
      .select()
      .from(challengeParticipants)
      .where(
        and(
          eq(challengeParticipants.challengeId, challengeId),
          eq(challengeParticipants.userId, userId),
        ),
      );
    if (!c || !p) return 0;
    const criteria = this.criteria(c);
    const { members, rows } = await this.teamOf(c, p);
    const toCheckIn = (f: {
      userId: string;
      ref: string;
      attrs: Record<string, unknown>;
    }): QualifyingCheckIn => ({
      userId: f.userId,
      eventId: f.ref,
      venueId: str(f.attrs.venueId),
      neighbourhoodId: str(f.attrs.neighbourhoodId),
      categoryId: str(f.attrs.categoryId),
    });
    const end = now < c.endsAt ? now : c.endsAt;
    const during = (
      await this.gamification.factsOf(members, 'check_in', c.startsAt, new Date(end.getTime() + 1))
    ).map(toCheckIn);
    const before = criteria.newPlacesOnly
      ? (await this.gamification.factsOf(members, 'check_in', new Date(0), c.startsAt)).map(
          toCheckIn,
        )
      : [];
    const squadOk = new Set<string>();
    if (criteria.withSquad) {
      for (const ci of during) {
        const [friends, there] = await Promise.all([
          this.graph.friendIds(ci.userId),
          this.search.checkedInAndHosts(ci.eventId),
        ]);
        const present = new Set(there);
        if (friends.some((f) => present.has(f))) squadOk.add(`${ci.userId}:${ci.eventId}`);
      }
    }
    const progress = challengeProgress(criteria, during, before, (ci) =>
      squadOk.has(`${ci.userId}:${ci.eventId}`),
    );
    const done = progress >= criteria.target;
    const newlyDone = await this.db.transaction(async (tx) => {
      const ids = rows.map((r) => r.userId);
      await tx
        .update(challengeParticipants)
        .set({ progress })
        .where(
          and(
            eq(challengeParticipants.challengeId, c.id),
            inArray(challengeParticipants.userId, ids),
          ),
        );
      if (!done) return [];
      const completed = await tx
        .update(challengeParticipants)
        .set({ completedAt: now })
        .where(
          and(
            eq(challengeParticipants.challengeId, c.id),
            inArray(challengeParticipants.userId, ids),
            isNull(challengeParticipants.completedAt),
          ),
        )
        .returning({ userId: challengeParticipants.userId });
      const who = completed.map((r) => r.userId);
      if (who.length > 0)
        await this.outbox.add(tx, {
          aggregateType: 'challenge',
          aggregateId: c.id,
          type: CHALLENGE_COMPLETED_EVENT,
          payload: { challengeId: c.id, userIds: who },
        });
      return who;
    });
    for (const u of newlyDone) {
      await this.gamification.recordFact({
        userId: u,
        kind: 'challenge_completed',
        ref: c.id,
        at: now,
      });
      if (c.rewardBadgeId) await this.gamification.award(u, c.rewardBadgeId, null, now);
      await this.gamification.evaluate(u, null, now);
    }
    return progress;
  }

  /** After a check-in: refresh every running challenge the person counts towards (directly or via a crew). */
  async onCheckIn(userId: string, now: Date = new Date()): Promise<number> {
    const crewIds = (await this.crews.activeCrewsOf(userId)).map((c) => c.id);
    const rows = await this.db
      .select({ p: challengeParticipants })
      .from(challengeParticipants)
      .innerJoin(challenges, eq(challenges.id, challengeParticipants.challengeId))
      .where(
        and(
          eq(challenges.active, true),
          lte(challenges.startsAt, now),
          gt(challenges.endsAt, now),
          isNull(challengeParticipants.completedAt),
          or(
            eq(challengeParticipants.userId, userId),
            crewIds.length > 0
              ? and(
                  isNotNull(challengeParticipants.crewId),
                  inArray(challengeParticipants.crewId, crewIds),
                )
              : sql`false`,
          ),
        ),
      );
    const seen = new Set<string>();
    let n = 0;
    for (const { p } of rows) {
      const team = `${p.challengeId}:${p.crewId ?? p.userId}`;
      if (seen.has(team)) continue;
      seen.add(team);
      await this.recompute(p.challengeId, p.userId, now);
      n += 1;
    }
    return n;
  }

  async titleOf(challengeId: string): Promise<LocalizedText | null> {
    const [c] = await this.db
      .select({ title: challenges.title })
      .from(challenges)
      .where(eq(challenges.id, challengeId));
    return c ? LocalizedText.parse(c.title) : null;
  }

  // ---------- admin ----------

  async adminList(): Promise<AdminChallenge[]> {
    const [rows, stats] = await Promise.all([
      this.db
        .select()
        .from(challenges)
        .orderBy(sql`${challenges.startsAt} DESC`),
      this.db
        .select({
          id: challengeParticipants.challengeId,
          n: count(),
          done: sql<number>`count(${challengeParticipants.completedAt})::int`,
        })
        .from(challengeParticipants)
        .groupBy(challengeParticipants.challengeId),
    ]);
    const byId = new Map(stats.map((s) => [s.id, s]));
    return rows.map((r) => ({
      id: r.id,
      title: LocalizedText.parse(r.title),
      description: LocalizedText.parse(r.description),
      emoji: r.emoji,
      startsAt: r.startsAt.toISOString(),
      endsAt: r.endsAt.toISOString(),
      mode: r.mode,
      criteria: this.criteria(r),
      rewardBadgeId: r.rewardBadgeId,
      active: r.active,
      participants: byId.get(r.id)?.n ?? 0,
      completed: byId.get(r.id)?.done ?? 0,
    }));
  }

  private async assertReward(tx: Tx, rewardBadgeId: string | null): Promise<void> {
    if (!rewardBadgeId) return;
    const [b] = await tx.select({ id: badges.id }).from(badges).where(eq(badges.id, rewardBadgeId));
    if (!b) throw AppError.notFound('Badge');
  }

  async adminCreate(adminId: string, body: UpsertChallengeBody): Promise<AdminChallenge> {
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await this.assertReward(tx, body.rewardBadgeId);
      await tx.insert(challenges).values({
        id,
        ...body,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        createdBy: adminId,
      });
      await this.audit.record(
        {
          adminUserId: adminId,
          action: 'challenge.create',
          targetType: 'challenge',
          targetId: id,
          details: { title: body.title.en },
        },
        tx,
      );
    });
    return this.adminOne(id);
  }

  async adminUpdate(
    adminId: string,
    id: string,
    body: UpsertChallengeBody,
  ): Promise<AdminChallenge> {
    await this.db.transaction(async (tx) => {
      const [c] = await tx
        .select({ id: challenges.id })
        .from(challenges)
        .where(eq(challenges.id, id))
        .for('update');
      if (!c) throw AppError.notFound('Challenge');
      await this.assertReward(tx, body.rewardBadgeId);
      await tx
        .update(challenges)
        .set({ ...body, startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt) })
        .where(eq(challenges.id, id));
      await this.audit.record(
        {
          adminUserId: adminId,
          action: 'challenge.update',
          targetType: 'challenge',
          targetId: id,
          details: { active: body.active },
        },
        tx,
      );
    });
    return this.adminOne(id);
  }

  private async adminOne(id: string): Promise<AdminChallenge> {
    const one = (await this.adminList()).find((c) => c.id === id);
    if (!one) throw AppError.notFound('Challenge');
    return one;
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const rows = await this.db
      .select()
      .from(challengeParticipants)
      .where(eq(challengeParticipants.userId, userId));
    return {
      challenges: rows.map((r) => ({
        challengeId: r.challengeId,
        progress: r.progress,
        completedAt: r.completedAt?.toISOString() ?? null,
      })),
    };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(challengeParticipants).where(eq(challengeParticipants.userId, userId));
  }
}
