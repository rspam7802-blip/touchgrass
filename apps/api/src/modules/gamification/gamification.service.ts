import { Inject, Injectable } from '@nestjs/common';
import {
  type AdminBadge,
  BadgeRule,
  type BadgeView,
  type EarnedBadge,
  type FactKind,
  type FactRow,
  freezeMonth,
  isoWeekKey,
  LocalizedText,
  ruleProgress,
  shiftIsoWeek,
  shouldFreeze,
  type StreakView,
  streakState,
  type SupportedLanguage,
  type UpsertBadgeBody,
} from '@touchgrass/shared';
import { and, asc, count, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import {
  badges,
  gamificationFacts,
  streakFreezes,
  streaks,
  userBadges,
} from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { UsersService } from '../users/users.service.js';

export const BADGE_EARNED_EVENT = 'badge.earned';

type BadgeRow = typeof badges.$inferSelect;
const RECENT_WEEKS = 8;

function toAttrs(v: unknown): FactRow['attrs'] {
  return typeof v === 'object' && v !== null ? v : {};
}

export interface FactInput {
  userId: string;
  kind: FactKind;
  ref: string;
  at: Date;
  attrs?: Record<string, string | boolean | string[] | null>;
}

/**
 * The gamification ledger (F-GAM-01/02): idempotent facts recorded from domain events, rule-based badges
 * evaluated against them, and the weekly outside streak with its monthly freeze.
 */
@Injectable()
export class GamificationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly users: UsersService,
  ) {}

  // ---------- facts ----------

  /** Records a fact once; replays of the same domain event are no-ops. Returns whether it was new. */
  async recordFact(f: FactInput, db: DbOrTx = this.db): Promise<boolean> {
    const rows = await db
      .insert(gamificationFacts)
      .values({ userId: f.userId, kind: f.kind, ref: f.ref, at: f.at, attrs: f.attrs ?? {} })
      .onConflictDoNothing()
      .returning({ ref: gamificationFacts.ref });
    return rows.length > 0;
  }

  async facts(
    userId: string,
    opts: { kinds?: FactKind[]; from?: Date; to?: Date } = {},
  ): Promise<(FactRow & { ref: string; at: Date })[]> {
    const rows = await this.db
      .select()
      .from(gamificationFacts)
      .where(
        and(
          eq(gamificationFacts.userId, userId),
          opts.kinds ? inArray(gamificationFacts.kind, opts.kinds) : sql`true`,
          opts.from ? gte(gamificationFacts.at, opts.from) : sql`true`,
          opts.to ? lt(gamificationFacts.at, opts.to) : sql`true`,
        ),
      )
      .orderBy(asc(gamificationFacts.at));
    return rows.map((r) => ({
      kind: r.kind as FactKind,
      ref: r.ref,
      at: r.at,
      attrs: toAttrs(r.attrs),
    }));
  }

  /** Facts of several people (group challenges). */
  async factsOf(
    userIds: string[],
    kind: FactKind,
    from: Date,
    to: Date,
  ): Promise<{ userId: string; ref: string; at: Date; attrs: Record<string, unknown> }[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select()
      .from(gamificationFacts)
      .where(
        and(
          inArray(gamificationFacts.userId, userIds),
          eq(gamificationFacts.kind, kind),
          gte(gamificationFacts.at, from),
          lt(gamificationFacts.at, to),
        ),
      );
    return rows.map((r) => ({
      userId: r.userId,
      ref: r.ref,
      at: r.at,
      attrs: (r.attrs ?? {}) as Record<string, unknown>,
    }));
  }

  // ---------- badges ----------

  private parseRule(row: BadgeRow): BadgeRule | null {
    const parsed = BadgeRule.safeParse(row.rule);
    return parsed.success ? parsed.data : null;
  }

  /**
   * Awards every active badge whose rule is now met. `eventId` is the plan that triggered it (shown on the
   * post-event card). Returns the newly earned badge ids.
   */
  async evaluate(
    userId: string,
    eventId: string | null,
    now: Date = new Date(),
  ): Promise<string[]> {
    const [all, earned, facts] = await Promise.all([
      this.db.select().from(badges).where(eq(badges.active, true)),
      this.db
        .select({ id: userBadges.badgeId })
        .from(userBadges)
        .where(eq(userBadges.userId, userId)),
      this.facts(userId),
    ]);
    const have = new Set(earned.map((e) => e.id));
    const fresh: string[] = [];
    for (const b of all) {
      if (have.has(b.id)) continue;
      const rule = this.parseRule(b);
      if (!rule) continue;
      const p = ruleProgress(rule, facts);
      if (p.current < p.target) continue;
      if (await this.award(userId, b.id, eventId, now)) fresh.push(b.id);
    }
    return fresh;
  }

  /** Gives a badge once (rules or challenge rewards) and announces it. */
  async award(
    userId: string,
    badgeId: string,
    eventId: string | null,
    now: Date = new Date(),
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .insert(userBadges)
        .values({ userId, badgeId, earnedAt: now, eventId })
        .onConflictDoNothing()
        .returning({ badgeId: userBadges.badgeId });
      if (rows.length === 0) return false;
      await this.outbox.add(tx, {
        aggregateType: 'user',
        aggregateId: userId,
        type: BADGE_EARNED_EVENT,
        payload: { userId, badgeId },
      });
      return true;
    });
  }

  async badgeById(id: string): Promise<{ key: string; name: LocalizedText; emoji: string } | null> {
    const [b] = await this.db.select().from(badges).where(eq(badges.id, id));
    return b ? { key: b.key, name: LocalizedText.parse(b.name), emoji: b.emoji } : null;
  }

  async badgesByIds(
    ids: string[],
  ): Promise<Map<string, { key: string; name: LocalizedText; emoji: string }>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db.select().from(badges).where(inArray(badges.id, ids));
    return new Map(
      rows.map((b) => [b.id, { key: b.key, name: LocalizedText.parse(b.name), emoji: b.emoji }]),
    );
  }

  /** Everything collectable: earned badges (even ones since retired) and active ones with progress. */
  async myBadges(userId: string): Promise<BadgeView[]> {
    const [all, earned, facts] = await Promise.all([
      this.db.select().from(badges).orderBy(asc(badges.sort), asc(badges.createdAt)),
      this.db.select().from(userBadges).where(eq(userBadges.userId, userId)),
      this.facts(userId),
    ]);
    const earnedAt = new Map(earned.map((e) => [e.badgeId, e.earnedAt]));
    return all.flatMap((b) => {
      const at = earnedAt.get(b.id);
      if (!b.active && !at) return [];
      const rule = this.parseRule(b);
      const progress = rule ? ruleProgress(rule, facts) : { current: 0, target: 1 };
      return [
        {
          key: b.key,
          name: LocalizedText.parse(b.name),
          description: LocalizedText.parse(b.description),
          emoji: b.emoji,
          earnedAt: at?.toISOString() ?? null,
          progress: at ? { current: progress.target, target: progress.target } : progress,
        },
      ];
    });
  }

  /** Post-event card (BadgesReader): badges earned at this plan, named in the person's language. */
  async earnedAt(userId: string, eventId: string): Promise<EarnedBadge[]> {
    const rows = await this.db
      .select({ key: badges.key, name: badges.name, emoji: badges.emoji })
      .from(userBadges)
      .innerJoin(badges, eq(badges.id, userBadges.badgeId))
      .where(and(eq(userBadges.userId, userId), eq(userBadges.eventId, eventId)));
    const lang: SupportedLanguage = (await this.users.languages([userId])).get(userId) ?? 'en';
    return rows.map((r) => ({
      key: r.key,
      name: LocalizedText.parse(r.name)[lang],
      emoji: r.emoji,
    }));
  }

  /** Badges a person earned in [from, to) (recaps). */
  async earnedBetween(userId: string, from: Date, to: Date) {
    return this.db
      .select({ key: badges.key, name: badges.name, emoji: badges.emoji })
      .from(userBadges)
      .innerJoin(badges, eq(badges.id, userBadges.badgeId))
      .where(
        and(
          eq(userBadges.userId, userId),
          gte(userBadges.earnedAt, from),
          lt(userBadges.earnedAt, to),
        ),
      )
      .then((rows) =>
        rows.map((r) => ({ key: r.key, name: LocalizedText.parse(r.name), emoji: r.emoji })),
      );
  }

  // ---------- admin badges ----------

  async adminList(): Promise<AdminBadge[]> {
    const [rows, counts] = await Promise.all([
      this.db.select().from(badges).orderBy(asc(badges.sort), asc(badges.createdAt)),
      this.db
        .select({ id: userBadges.badgeId, n: count() })
        .from(userBadges)
        .groupBy(userBadges.badgeId),
    ]);
    const n = new Map(counts.map((c) => [c.id, c.n]));
    return rows.flatMap((b) => {
      const rule = this.parseRule(b);
      return rule
        ? [
            {
              id: b.id,
              key: b.key,
              name: LocalizedText.parse(b.name),
              description: LocalizedText.parse(b.description),
              emoji: b.emoji,
              rule,
              active: b.active,
              builtin: b.builtin,
              earnedCount: n.get(b.id) ?? 0,
            },
          ]
        : [];
    });
  }

  async adminCreate(adminId: string, body: UpsertBadgeBody): Promise<AdminBadge> {
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      const [dup] = await tx.select({ id: badges.id }).from(badges).where(eq(badges.key, body.key));
      if (dup) throw new AppError('CONFLICT', 'A badge with that key exists');
      await tx.insert(badges).values({ id, ...body });
      await this.audit.record(
        {
          adminUserId: adminId,
          action: 'badge.create',
          targetType: 'badge',
          targetId: id,
          details: { key: body.key },
        },
        tx,
      );
    });
    return this.adminOne(id);
  }

  /** Built-in badges keep their key and rule (other features rely on them); names and status are editable. */
  async adminUpdate(adminId: string, id: string, body: UpsertBadgeBody): Promise<AdminBadge> {
    await this.db.transaction(async (tx) => {
      const [b] = await tx.select().from(badges).where(eq(badges.id, id)).for('update');
      if (!b) throw AppError.notFound('Badge');
      if (
        b.builtin &&
        (b.key !== body.key || JSON.stringify(this.parseRule(b)) !== JSON.stringify(body.rule))
      )
        throw new AppError('CONFLICT', 'Built-in badges keep their key and rule');
      if (b.key !== body.key) {
        const [dup] = await tx
          .select({ id: badges.id })
          .from(badges)
          .where(eq(badges.key, body.key));
        if (dup) throw new AppError('CONFLICT', 'A badge with that key exists');
      }
      await tx.update(badges).set(body).where(eq(badges.id, id));
      await this.audit.record(
        {
          adminUserId: adminId,
          action: 'badge.update',
          targetType: 'badge',
          targetId: id,
          details: { key: body.key, active: body.active },
        },
        tx,
      );
    });
    return this.adminOne(id);
  }

  private async adminOne(id: string): Promise<AdminBadge> {
    const one = (await this.adminList()).find((b) => b.id === id);
    if (!one) throw AppError.notFound('Badge');
    return one;
  }

  // ---------- streaks (F-GAM-02) ----------

  private async weeks(userId: string): Promise<{ out: Set<string>; frozen: Set<string> }> {
    const [ins, freezes] = await Promise.all([
      this.db
        .select({ at: gamificationFacts.at })
        .from(gamificationFacts)
        .where(and(eq(gamificationFacts.userId, userId), eq(gamificationFacts.kind, 'check_in'))),
      this.db
        .select({ week: streakFreezes.week })
        .from(streakFreezes)
        .where(eq(streakFreezes.userId, userId)),
    ]);
    return {
      out: new Set(ins.map((r) => isoWeekKey(r.at))),
      frozen: new Set(freezes.map((f) => f.week)),
    };
  }

  async refreshStreak(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ current: number; longest: number }> {
    const { out, frozen } = await this.weeks(userId);
    const s = streakState(out, frozen, isoWeekKey(now));
    await this.db
      .insert(streaks)
      .values({ userId, current: s.current, longest: s.longest, updatedAt: now })
      .onConflictDoUpdate({
        target: streaks.userId,
        set: { current: s.current, longest: s.longest, updatedAt: now },
      });
    return { current: s.current, longest: s.longest };
  }

  async streak(userId: string, now: Date = new Date()): Promise<StreakView> {
    const { out, frozen } = await this.weeks(userId);
    const week = isoWeekKey(now);
    const s = streakState(out, frozen, week);
    const month = freezeMonth(week);
    const usedThisMonth = [...frozen].some((w) => freezeMonth(w) === month);
    const recentWeeks = Array.from({ length: RECENT_WEEKS }, (_, i) => {
      const w = shiftIsoWeek(week, i - (RECENT_WEEKS - 1));
      return {
        week: w,
        state: out.has(w)
          ? ('out' as const)
          : frozen.has(w)
            ? ('freeze' as const)
            : ('none' as const),
      };
    });
    return {
      current: s.current,
      longest: s.longest,
      thisWeek: s.thisWeek,
      atRisk: s.current > 0 && !s.thisWeek,
      freezeAvailable: !usedThisMonth,
      weekKey: week,
      recentWeeks,
    };
  }

  /** Longest run of covered weeks inside [from, to) (recaps). */
  async longestStreakBetween(userId: string, from: Date, to: Date): Promise<number> {
    const { out, frozen } = await this.weeks(userId);
    const first = isoWeekKey(from);
    const last = isoWeekKey(new Date(to.getTime() - 1));
    const inRange = (w: string) => w >= first && w <= last;
    return streakState(
      new Set([...out].filter(inRange)),
      new Set([...frozen].filter(inRange)),
      shiftIsoWeek(last, 1),
    ).longest;
  }

  /**
   * Monday job: a live streak that missed last week uses the month's freeze automatically, so one busy week
   * doesn't wipe it out.
   */
  async applyFreezes(now: Date = new Date()): Promise<number> {
    const missed = shiftIsoWeek(isoWeekKey(now), -1);
    const live = await this.db
      .select({ userId: streaks.userId })
      .from(streaks)
      .where(sql`${streaks.current} > 0`);
    let frozen = 0;
    for (const { userId } of live) {
      const w = await this.weeks(userId);
      if (shouldFreeze(w.out, w.frozen, missed)) {
        await this.db.insert(streakFreezes).values({ userId, week: missed }).onConflictDoNothing();
        frozen += 1;
      }
      await this.refreshStreak(userId, now);
    }
    return frozen;
  }

  /** People with a live streak who haven't counted this week and weren't reminded yet. */
  async atRisk(now: Date = new Date()): Promise<{ userId: string; current: number }[]> {
    const week = isoWeekKey(now);
    const live = await this.db
      .select()
      .from(streaks)
      .where(
        and(sql`${streaks.current} > 0`, sql`${streaks.remindedWeek} IS DISTINCT FROM ${week}`),
      );
    const out: { userId: string; current: number }[] = [];
    for (const r of live) {
      const s = await this.streak(r.userId, now);
      if (s.atRisk) out.push({ userId: r.userId, current: s.current });
    }
    return out;
  }

  async markReminded(userIds: string[], now: Date = new Date()): Promise<void> {
    if (userIds.length === 0) return;
    await this.db
      .update(streaks)
      .set({ remindedWeek: isoWeekKey(now) })
      .where(inArray(streaks.userId, userIds));
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const [facts, earned, streak, freezes] = await Promise.all([
      this.facts(userId),
      this.db
        .select({ key: badges.key, earnedAt: userBadges.earnedAt })
        .from(userBadges)
        .innerJoin(badges, eq(badges.id, userBadges.badgeId))
        .where(eq(userBadges.userId, userId)),
      this.db.select().from(streaks).where(eq(streaks.userId, userId)),
      this.db.select().from(streakFreezes).where(eq(streakFreezes.userId, userId)),
    ]);
    return {
      gamification: {
        activity: facts.map((f) => ({ kind: f.kind, ref: f.ref, at: f.at.toISOString() })),
        badges: earned.map((e) => ({ key: e.key, earnedAt: e.earnedAt.toISOString() })),
        streak: streak[0] ? { current: streak[0].current, longest: streak[0].longest } : null,
        freezes: freezes.map((f) => f.week),
      },
    };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx.delete(gamificationFacts).where(eq(gamificationFacts.userId, userId));
    await tx.delete(userBadges).where(eq(userBadges.userId, userId));
    await tx.delete(streakFreezes).where(eq(streakFreezes.userId, userId));
    await tx.delete(streaks).where(eq(streaks.userId, userId));
  }
}
