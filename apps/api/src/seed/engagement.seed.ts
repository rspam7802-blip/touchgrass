import {
  BadgeRule,
  type FactRow,
  isoWeekKey,
  LIMITS,
  ruleProgress,
  streakState,
} from '@touchgrass/shared';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Tx } from '../infra/database/database.module.js';
import {
  availabilityStatus,
  badges,
  challenges,
  crewMembers,
  crewRecurrence,
  crews,
  gamificationFacts,
  planProposals,
  proposalInvitees,
  proposalOptions,
  proposalVotes,
  referralCodes,
  referralRewards,
  referrals,
  streaks,
  userBadges,
} from '../infra/database/schema/index.js';

export interface EngagementSeedSummary {
  crews: number;
  crewMembers: number;
  available: number;
  proposals: number;
  facts: number;
  badgesEarned: number;
  challenges: number;
  referralCodes: number;
}

const H = 3_600_000;
const DAY = 24 * H;
const names = (en: string, te: string, hi: string) => ({ en, te, hi });

/** Next occurrence of an IST weekday (1 = Monday … 7 = Sunday) at hh:mm IST, at least a day ahead. */
function nextIst(now: Date, weekday: number, hh: number, mm: number): Date {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const jsDay = ist.getUTCDay() === 0 ? 7 : ist.getUTCDay();
  const ahead = ((weekday - jsDay + 7) % 7) + 7;
  const d = new Date(
    Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + ahead, hh, mm),
  );
  return new Date(d.getTime() - 330 * 60_000);
}

/**
 * Phase 8 seed (idempotent): four crews with members and schedules (the worker generates their sessions),
 * a few squad members free right now, two open plan votes, gamification facts/badges/streaks backfilled from
 * seeded check-ins, two live challenges, and referral codes with one rewarded referral.
 */
export async function seedEngagement(
  tx: Tx,
  ctx: { cityId: string; memberIds: string[]; interestIds: string[]; adminId: string },
  now: Date = new Date(),
): Promise<EngagementSeedSummary> {
  const m = (n: number): string => {
    const id = ctx.memberIds[n - 1];
    if (!id) throw new Error(`Seed member #${String(n)} missing`);
    return id;
  };
  const interest = (i: number): string => ctx.interestIds[i % ctx.interestIds.length] ?? '';
  const venues = await tx.execute<{ id: string; name: string }>(
    sql`SELECT id, name FROM venues WHERE city_id = ${ctx.cityId} ORDER BY name LIMIT 4`,
  );

  // ---------- crews ----------
  const crewDefs = [
    {
      name: 'Sunday Run Club',
      admin: 3,
      policy: 'request' as const,
      members: [1, 2, 4, 5, 7, 8],
      rrule: 'FREQ=WEEKLY;BYDAY=SU',
      day: 7,
      at: [6, 0],
      minutes: 90,
    },
    {
      name: 'Board Game Nights',
      admin: 6,
      policy: 'request' as const,
      members: [2, 4, 10, 11],
      rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=FR',
      day: 5,
      at: [19, 30],
      minutes: 180,
    },
    {
      name: 'Telugu Book Circle',
      admin: 9,
      policy: 'invite_only' as const,
      members: [1, 13, 14],
      rrule: 'FREQ=MONTHLY;BYDAY=1SA',
      day: 6,
      at: [17, 0],
      minutes: 120,
    },
    {
      name: 'Sketch Walks',
      admin: 12,
      policy: 'request' as const,
      members: [15, 16],
      rrule: 'FREQ=MONTHLY;BYDAY=-1SU',
      day: 7,
      at: [8, 0],
      minutes: 120,
    },
  ];
  for (const [i, c] of crewDefs.entries()) {
    const adminId = m(c.admin);
    const [existing] = await tx
      .select({ id: crews.id })
      .from(crews)
      .where(and(eq(crews.name, c.name), eq(crews.createdBy, adminId)));
    if (existing) continue;
    const id = uuidv7();
    await tx.insert(crews).values({
      id,
      cityId: ctx.cityId,
      name: c.name,
      description: `${c.name}: the same people, on a regular rhythm. New faces welcome.`,
      interestId: interest(i),
      joinPolicy: c.policy,
      createdBy: adminId,
    });
    await tx
      .insert(crewMembers)
      .values({ crewId: id, userId: adminId, role: 'admin', status: 'active', joinedAt: now });
    for (const n of c.members)
      await tx
        .insert(crewMembers)
        .values({ crewId: id, userId: m(n), role: 'member', status: 'active', joinedAt: now });
    // Someone waiting on each open crew, so admins see the request queue.
    if (c.policy === 'request')
      await tx
        .insert(crewMembers)
        .values({ crewId: id, userId: m(20 + i), role: 'member', status: 'requested' })
        .onConflictDoNothing();
    else
      await tx
        .insert(crewMembers)
        .values({ crewId: id, userId: m(2), role: 'member', status: 'invited', invitedBy: adminId })
        .onConflictDoNothing();
    const venue = venues.rows[i % Math.max(1, venues.rows.length)];
    if (venue) {
      const [hh, mm] = c.at as [number, number];
      await tx.insert(crewRecurrence).values({
        crewId: id,
        rrule: c.rrule,
        startsAt: nextIst(now, c.day, hh, mm),
        durationMinutes: c.minutes,
        capacity: 20,
        title: '',
        locationWhere: { venueId: venue.id },
        placeLabel: venue.name,
        hostUserId: adminId,
      });
    }
  }

  // ---------- free now ----------
  for (const n of [4, 5, 7]) {
    await tx
      .insert(availabilityStatus)
      .values({
        userId: m(n),
        until: new Date(now.getTime() + 3 * H),
        note: n === 4 ? 'Down for chai near Madhapur ☕' : '',
      })
      .onConflictDoUpdate({
        target: availabilityStatus.userId,
        set: { until: new Date(now.getTime() + 3 * H) },
      });
  }

  // ---------- plan votes ----------
  const proposalDefs = [
    { title: 'Board games this weekend?', creator: 4, invitees: [5, 6, 7] },
    { title: 'Biryani crawl', creator: 2, invitees: [3, 4, 5] },
  ];
  for (const [i, p] of proposalDefs.entries()) {
    const creatorId = m(p.creator);
    const [existing] = await tx
      .select({ id: planProposals.id })
      .from(planProposals)
      .where(and(eq(planProposals.title, p.title), eq(planProposals.creatorId, creatorId)));
    if (existing) continue;
    const squad = await tx.execute<{ id: string }>(
      sql`SELECT friend_id AS id FROM squad_edges WHERE user_id = ${creatorId}`,
    );
    const friendSet = new Set(squad.rows.map((r) => r.id));
    const invitees = p.invitees.map(m).filter((id) => friendSet.has(id));
    const id = uuidv7();
    await tx.insert(planProposals).values({
      id,
      creatorId,
      cityId: ctx.cityId,
      title: p.title,
      categoryInterestId: interest(i + 1),
      deadline: new Date(now.getTime() + DAY),
      capacity: 8,
    });
    for (const u of invitees)
      await tx.insert(proposalInvitees).values({ proposalId: id, userId: u });
    const t1 = new Date(now.getTime() + 3 * DAY);
    const t2 = new Date(now.getTime() + 4 * DAY);
    const optionIds: string[] = [];
    for (const o of [
      { kind: 'time' as const, startsAt: t1, endsAt: new Date(t1.getTime() + 3 * H) },
      { kind: 'time' as const, startsAt: t2, endsAt: new Date(t2.getTime() + 3 * H) },
      ...venues.rows
        .slice(0, 2)
        .map((v) => ({ kind: 'place' as const, label: v.name, locationWhere: { venueId: v.id } })),
      { kind: 'activity' as const, label: i === 0 ? 'Catan' : 'Hyderabadi biryani' },
    ]) {
      const oid = uuidv7();
      optionIds.push(oid);
      await tx
        .insert(proposalOptions)
        .values({ id: oid, proposalId: id, createdBy: creatorId, ...o });
    }
    for (const [j, u] of invitees.entries()) {
      const pick = optionIds[j % optionIds.length];
      if (pick)
        await tx.insert(proposalVotes).values({ optionId: pick, userId: u }).onConflictDoNothing();
    }
  }

  // ---------- gamification backfill ----------
  await tx.execute(sql`
    INSERT INTO gamification_facts (user_id, kind, ref, at, attrs)
    SELECT r.user_id, 'check_in', r.event_id::text, coalesce(r.checked_in_at, e.starts_at),
      jsonb_build_object(
        'eventId', e.id, 'venueId', e.venue_id, 'neighbourhoodId', e.neighbourhood_id,
        'categoryId', e.category_interest_id,
        'onTime', coalesce(r.checked_in_at, e.starts_at) <= e.starts_at + interval '10 minutes',
        'vibeTagIds', coalesce((SELECT jsonb_agg(v.vibe_tag_id) FROM event_vibe_tags v WHERE v.event_id = e.id), '[]'::jsonb))
    FROM rsvps r JOIN events e ON e.id = r.event_id
    WHERE r.status = 'checked_in'
    ON CONFLICT DO NOTHING`);
  await tx.execute(sql`
    INSERT INTO gamification_facts (user_id, kind, ref, at, attrs)
    SELECT e.creator_user_id, 'hosted', e.id::text, e.ends_at, jsonb_build_object('eventId', e.id)
    FROM events e
    WHERE e.status = 'completed' AND EXISTS (
      SELECT 1 FROM rsvps r WHERE r.event_id = e.id AND r.status = 'checked_in' AND r.user_id <> e.creator_user_id)
    ON CONFLICT DO NOTHING`);
  const allBadges = await tx.select().from(badges).where(eq(badges.active, true));
  const factRows = await tx.select().from(gamificationFacts);
  const byUser = new Map<string, (FactRow & { at: Date })[]>();
  for (const f of factRows)
    byUser.set(f.userId, [
      ...(byUser.get(f.userId) ?? []),
      { kind: f.kind as FactRow['kind'], at: f.at, attrs: f.attrs as FactRow['attrs'] },
    ]);
  for (const [userId, facts] of byUser) {
    const lastAt = facts.reduce((t, f) => (f.at > t ? f.at : t), new Date(0));
    for (const b of allBadges) {
      const rule = BadgeRule.safeParse(b.rule);
      if (!rule.success) continue;
      const p = ruleProgress(rule.data, facts);
      if (p.current >= p.target)
        await tx
          .insert(userBadges)
          .values({ userId, badgeId: b.id, earnedAt: lastAt })
          .onConflictDoNothing();
    }
    const weeks = new Set(facts.filter((f) => f.kind === 'check_in').map((f) => isoWeekKey(f.at)));
    const s = streakState(weeks, new Set(), isoWeekKey(now));
    await tx
      .insert(streaks)
      .values({ userId, current: s.current, longest: s.longest })
      .onConflictDoUpdate({
        target: streaks.userId,
        set: { current: s.current, longest: s.longest },
      });
  }

  // ---------- challenges ----------
  const challengeDefs = [
    {
      title: names('Café crawl', 'కేఫ్ క్రాల్', 'कैफ़े क्रॉल'),
      description: names(
        'Check in at 3 new spots this month.',
        'ఈ నెల 3 కొత్త చోట్ల చెక్-ఇన్ అవ్వు.',
        'इस महीने 3 नई जगहों पर चेक-इन करो.',
      ),
      emoji: '☕',
      mode: 'solo' as const,
      criteria: {
        target: 3,
        distinct: 'venueId' as const,
        categoryInterestId: null,
        newPlacesOnly: true,
        withSquad: false,
      },
    },
    {
      title: names('Crew outside week', 'క్రూ అవుట్‌సైడ్ వీక్', 'क्रू आउटसाइड वीक'),
      description: names(
        'Your crew pulls up to 4 plans together.',
        'మీ క్రూ కలిసి 4 ప్లాన్‌లకు వెళ్లాలి.',
        'तुम्हारी क्रू साथ में 4 प्लान पर जाए.',
      ),
      emoji: '🔥',
      mode: 'group' as const,
      criteria: {
        target: 4,
        distinct: null,
        categoryInterestId: null,
        newPlacesOnly: false,
        withSquad: false,
      },
    },
  ];
  const [champ] = await tx.select({ id: badges.id }).from(badges).where(eq(badges.key, 'explorer'));
  for (const c of challengeDefs) {
    const [existing] = await tx
      .select({ id: challenges.id })
      .from(challenges)
      .where(sql`${challenges.title}->>'en' = ${c.title.en}`);
    if (existing) continue;
    await tx.insert(challenges).values({
      id: uuidv7(),
      ...c,
      startsAt: new Date(now.getTime() - DAY),
      endsAt: new Date(now.getTime() + 27 * DAY),
      rewardBadgeId: c.mode === 'solo' ? (champ?.id ?? null) : null,
      createdBy: ctx.adminId,
    });
  }

  // ---------- referrals ----------
  const codeChars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  for (let n = 1; n <= 12; n += 1) {
    const code = `${LIMITS.referrals.codePrefix}${Array.from({ length: LIMITS.referrals.codeLength }, (_, k) => codeChars.charAt((n * 7 + k * 11) % codeChars.length)).join('')}`;
    await tx
      .insert(referralCodes)
      .values({ userId: m(n), code })
      .onConflictDoNothing();
  }
  const [ref2] = await tx
    .select()
    .from(referralCodes)
    .where(eq(referralCodes.userId, m(2)));
  if (ref2) {
    const refereeId = m(30);
    const [already] = await tx
      .select({ id: referrals.id })
      .from(referrals)
      .where(eq(referrals.refereeId, refereeId));
    if (!already) {
      const [u] = await tx
        .execute<{ phone_hash: string }>(sql`SELECT phone_hash FROM users WHERE id = ${refereeId}`)
        .then((r) => r.rows);
      const referralId = uuidv7();
      await tx.insert(referrals).values({
        id: referralId,
        referrerId: m(2),
        refereeId,
        code: ref2.code,
        refereePhoneHash: u?.phone_hash ?? `seed-${refereeId}`,
        status: 'rewarded',
        rewardedAt: now,
      });
      await tx.insert(referralRewards).values([
        {
          id: uuidv7(),
          userId: m(2),
          referralId,
          kind: 'priority_pass',
          remaining: LIMITS.referrals.defaultPriorityPasses,
        },
        {
          id: uuidv7(),
          userId: m(2),
          referralId,
          kind: 'credit',
          remaining: 1,
          maxPaise: LIMITS.referrals.defaultCreditMaxRupees * 100,
        },
      ]);
      await tx
        .insert(gamificationFacts)
        .values({
          userId: m(2),
          kind: 'referral',
          ref: refereeId,
          at: now,
          attrs: { otherUserId: refereeId },
        })
        .onConflictDoNothing();
      const [plug] = await tx.select({ id: badges.id }).from(badges).where(eq(badges.key, 'plug'));
      if (plug)
        await tx
          .insert(userBadges)
          .values({ userId: m(2), badgeId: plug.id, earnedAt: now })
          .onConflictDoNothing();
    }
  }

  const n = async (table: string): Promise<number> =>
    (await tx.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`))
      .rows[0]?.n ?? 0;
  return {
    crews: await n('crews'),
    crewMembers: await n('crew_members'),
    available:
      (
        await tx.execute<{ n: number }>(
          sql`SELECT count(*)::int AS n FROM availability_status WHERE until > ${now}`,
        )
      ).rows[0]?.n ?? 0,
    proposals: await n('plan_proposals'),
    facts: await n('gamification_facts'),
    badgesEarned: await n('user_badges'),
    challenges: await n('challenges'),
    referralCodes: await n('referral_codes'),
  };
}
