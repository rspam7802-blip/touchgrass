import {
  type AdminBadge,
  type BadgeList,
  type ChallengeList,
  isoWeekKey,
  type MyReferrals,
  type PostEventCard,
  type RecapList,
  shiftIsoWeek,
  type StreakView,
} from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakePaymentsGateway } from '../src/adapters/payments/fake.payments.js';
import { EventStore } from '../src/modules/events/event-store.service.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { GamificationHandlers } from '../src/modules/gamification/gamification.handlers.js';
import { GamificationService } from '../src/modules/gamification/gamification.service.js';
import { RecapsService } from '../src/modules/gamification/recaps.service.js';
import { PayoutsService } from '../src/modules/payments/payouts.service.js';
import { RefundsService } from '../src/modules/payments/refunds.service.js';
import { WebhooksService } from '../src/modules/payments/webhooks.service.js';
import { ReferralsHandlers } from '../src/modules/referrals/referrals.handlers.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { DomainEventBus } from '../src/worker/domain-event-bus.js';
import { idem, plot, rsvp, shiftEvent, verifiedMember } from './event-helpers.js';
import {
  befriend,
  bearer,
  createHarness,
  device,
  fromIp,
  type Harness,
  interestIds,
  member,
  type Member,
  onboard,
  setInviteGate,
  signIn,
} from './harness.js';

let h: Harness;
let admin: Member;
const gateway = new FakePaymentsGateway();
const H = 3_600_000;
const DAY = 24 * H;

beforeAll(async () => {
  h = await createHarness({ payments: gateway });
  const s = await signIn(h);
  await onboard(h, s.accessToken);
  await h.app.get(UsersService).grantRole(s.user.id, 'admin', null);
  const refreshed = await request(h.http)
    .post('/v1/auth/refresh')
    .set(...fromIp())
    .send({ refreshToken: s.refreshToken })
    .expect(200);
  admin = { id: s.user.id, token: refreshed.body.accessToken as string, phone: s.phone };
});
afterAll(async () => {
  await h.close();
});

const get = (m: Member, path: string) =>
  request(h.http)
    .get(path)
    .set(...bearer(m.token));
const post = (m: Member, path: string, body: object = {}) =>
  request(h.http)
    .post(path)
    .set(...bearer(m.token))
    .set(...idem())
    .send(body);
const put = (m: Member, path: string, body: object) =>
  request(h.http)
    .put(path)
    .set(...bearer(m.token))
    .send(body);

function bus(): DomainEventBus {
  const b = new DomainEventBus();
  h.app.get(GamificationHandlers).registerOn(b);
  h.app.get(ReferralsHandlers).registerOn(b);
  return b;
}

let seq = 0;
async function dispatch(
  type: string,
  aggregateId: string,
  payload: Record<string, unknown>,
  at = new Date(),
) {
  seq += 1;
  await bus().dispatch({
    eventId: `00000000-0000-7000-8000-${String(seq).padStart(12, '0')}`,
    aggregateType: 'event',
    aggregateId,
    type,
    payload,
    occurredAt: at.toISOString(),
  });
}

/** Replays every outbox row of these types for an aggregate (what the worker would do). */
async function drain(types: string[], aggregateId: string): Promise<void> {
  const { rows } = await h.pool.query<{
    id: string;
    aggregate_type: string;
    aggregate_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    created_at: Date;
  }>(
    'SELECT * FROM outbox_events WHERE aggregate_id = $1 AND event_type = ANY($2) ORDER BY created_at',
    [aggregateId, types],
  );
  const b = bus();
  for (const r of rows)
    await b.dispatch({
      eventId: r.id,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      type: r.event_type,
      payload: r.payload,
      occurredAt: r.created_at.toISOString(),
    });
}

/** Pulls up, checks in (as the check-in service would record it) and runs the worker side. */
async function checkIn(
  m: Member,
  eventId: string,
  opts: { onTime?: boolean; at?: Date } = {},
): Promise<void> {
  await rsvp(h, m, eventId).expect(200);
  await h.pool.query(
    "UPDATE rsvps SET status = 'checked_in', checked_in_at = now(), check_in_method = 'qr' WHERE event_id = $1 AND user_id = $2",
    [eventId, m.id],
  );
  await dispatch(
    'rsvp.checked_in',
    eventId,
    { eventId, userId: m.id, method: 'qr', onTime: opts.onTime ?? true },
    opts.at,
  );
}

async function badgeKeys(m: Member): Promise<string[]> {
  const list = (await get(m, '/v1/me/badges').expect(200)).body as BadgeList;
  return list.items.filter((b) => b.earnedAt !== null).map((b) => b.key);
}

const names = (en: string) => ({ en, te: `${en} (te)`, hi: `${en} (hi)` });

// ---------- F-GAM-01 / F-GAM-02 ----------

describe('badges and streaks (F-GAM-01, F-GAM-02)', () => {
  it('a first check-in earns Grass Toucher, shows on the post-event card, and starts a streak; replays count once', async () => {
    const host = await verifiedMember(h);
    const a = await member(h);
    const plan = await plot(h, host);
    await checkIn(a, plan.id);
    await dispatch('rsvp.checked_in', plan.id, { eventId: plan.id, userId: a.id, onTime: true });
    const facts = await h.app.get(GamificationService).facts(a.id, { kinds: ['check_in'] });
    expect(facts).toHaveLength(1);
    expect(await badgeKeys(a)).toEqual(['grass_toucher']);
    const all = ((await get(a, '/v1/me/badges')).body as BadgeList).items;
    expect(all.find((b) => b.key === 'certified_outside')?.progress).toEqual({
      current: 1,
      target: 10,
    });
    expect(all.find((b) => b.key === 'early_bird')?.progress).toEqual({ current: 1, target: 5 });
    const streak = (await get(a, '/v1/me/streak').expect(200)).body as StreakView;
    expect(streak).toMatchObject({
      current: 1,
      longest: 1,
      thisWeek: true,
      atRisk: false,
      freezeAvailable: true,
    });
    expect(streak.recentWeeks.at(-1)).toEqual({ week: isoWeekKey(new Date()), state: 'out' });

    await shiftEvent(h, plan.id, -4 * H);
    const card = (await get(a, `/v1/events/${plan.id}/after`).expect(200)).body as PostEventCard;
    expect(card.badges).toEqual([{ key: 'grass_toucher', name: 'Grass Toucher', emoji: '🌱' }]);
    expect(
      await h.pool
        .query('SELECT 1 FROM outbox_events WHERE aggregate_id = $1 AND event_type = $2', [
          a.id,
          'badge.earned',
        ])
        .then((r) => r.rowCount),
    ).toBe(1);
    await drain(['badge.earned'], a.id);
    // Their squad sees it in the activity feed, with the badge named (F-SOC-04).
    const pal = await member(h);
    await befriend(h, a, pal);
    const feed = (await get(pal, '/v1/activity').expect(200)).body as {
      items: { verb: string; actor: { id: string }; object: { title: string | null } | null }[];
    };
    expect(
      feed.items.find((i) => i.verb === 'badge_earned' && i.actor.id === a.id)?.object?.title,
    ).toBe('🌱 Grass Toucher');

    // The host's plan counts as hosted once someone checked in.
    await h.app.get(EventsService).completeEnded();
    await drain(['event.completed'], plan.id);
    const hostBadges = ((await get(host, '/v1/me/badges')).body as BadgeList).items;
    expect(hostBadges.find((b) => b.key === 'main_character')?.progress).toEqual({
      current: 1,
      target: 5,
    });
  });

  it('crew sessions, reconnects and Lore photos are facts too', async () => {
    const host = await verifiedMember(h);
    const [a, b] = [await member(h), await member(h)];
    const plan = await plot(h, host);
    await dispatch('reconnect.mutual', plan.id, { eventId: plan.id, userIds: [a.id, b.id] });
    await dispatch('lore.added', plan.id, {
      eventId: plan.id,
      itemId: '0192f3a4-5b6c-7d8e-9f01-0000000a0a0a',
      uploaderId: a.id,
      first: true,
    });
    const g = h.app.get(GamificationService);
    expect((await g.facts(a.id)).map((f) => f.kind).sort()).toEqual(['lore_photo', 'reconnect']);
    expect((await g.facts(b.id)).map((f) => f.kind)).toEqual(['reconnect']);
    await dispatch('reconnect.mutual', plan.id, { eventId: plan.id, userIds: [a.id] });
    expect(await g.facts(b.id)).toHaveLength(1);
  });

  it('a missed week uses the monthly freeze; an uncounted week gets one reminder outside quiet hours', async () => {
    const g = h.app.get(GamificationService);
    const a = await member(h);
    // Noon IST today; their last check-in was two weeks ago.
    const today = new Date();
    const noon = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 6, 30),
    );
    const twoWeeksAgo = new Date(noon.getTime() - 14 * DAY);
    await g.recordFact({ userId: a.id, kind: 'check_in', ref: 'old-plan', at: twoWeeksAgo });
    await g.refreshStreak(a.id, twoWeeksAgo);
    expect(await g.applyFreezes(noon)).toBeGreaterThanOrEqual(1);
    const lastWeek = shiftIsoWeek(isoWeekKey(noon), -1);
    const s = await g.streak(a.id, noon);
    expect(s).toMatchObject({ current: 2, atRisk: true, thisWeek: false });
    expect(s.recentWeeks.find((w) => w.week === lastWeek)?.state).toBe('freeze');
    expect(await g.atRisk(noon)).toContainEqual({ userId: a.id, current: 2 });

    const handlers = h.app.get(GamificationHandlers);
    expect(await handlers.remindStreaks(new Date(noon.getTime() + 13 * H))).toBe(0); // 01:30 IST: quiet hours
    await handlers.remindStreaks(noon);
    expect((await g.atRisk(noon)).some((r) => r.userId === a.id)).toBe(false);
    // A second missed week in the same month isn't frozen again.
    expect(
      await g.longestStreakBetween(a.id, new Date(noon.getTime() - 30 * DAY), noon),
    ).toBeGreaterThanOrEqual(1);
  });

  it('admins add rule badges without code; built-ins keep their rule; changes are audited', async () => {
    const someone = await member(h);
    const body = {
      key: `first_hood_${Date.now() % 100000}`,
      name: names('Local'),
      description: names('Checked in somewhere new'),
      emoji: '📍',
      rule: { type: 'distinct', fact: 'check_in', field: 'eventId', threshold: 1 },
    };
    await post(someone, '/v1/admin/badges', body).expect(403);
    const created = (await post(admin, '/v1/admin/badges', body).expect(201)).body as AdminBadge;
    expect(created).toMatchObject({ key: body.key, builtin: false, active: true, earnedCount: 0 });
    await post(admin, '/v1/admin/badges', body).expect(409);
    await post(admin, '/v1/admin/badges', { ...body, key: 'Bad Key' }).expect(400);

    const host = await verifiedMember(h);
    const plan = await plot(h, host);
    await checkIn(someone, plan.id);
    expect(await badgeKeys(someone)).toContain(body.key);

    const list = (await get(admin, '/v1/admin/badges').expect(200)).body.items as AdminBadge[];
    const builtin = list.find((b) => b.key === 'explorer');
    if (!builtin) throw new Error('missing builtin');
    await put(admin, `/v1/admin/badges/${builtin.id}`, {
      ...builtin,
      rule: { ...builtin.rule, threshold: 2 },
    }).expect(409);
    const renamed = await put(admin, `/v1/admin/badges/${builtin.id}`, {
      key: builtin.key,
      name: { ...builtin.name, en: 'Explorer' },
      description: builtin.description,
      emoji: builtin.emoji,
      rule: builtin.rule,
      active: true,
    }).expect(200);
    expect(renamed.body.builtin).toBe(true);
    const off = await put(admin, `/v1/admin/badges/${created.id}`, {
      ...body,
      active: false,
    }).expect(200);
    expect(off.body).toMatchObject({ active: false, earnedCount: 1 });
    // Retired badges stay in your collection once earned, but nobody new can earn them.
    expect(await badgeKeys(someone)).toContain(body.key);
    const audit = await get(admin, '/v1/admin/audit-log').expect(200);
    const actions = (audit.body.items as { action: string }[]).map((x) => x.action);
    expect(actions).toEqual(expect.arrayContaining(['badge.create', 'badge.update']));
  });
});

// ---------- F-GAM-03 ----------

describe('challenges (F-GAM-03)', () => {
  it('solo: progress from check-ins in the window, completion awards the reward badge', async () => {
    const reward = (
      await post(admin, '/v1/admin/badges', {
        key: `double_${Date.now() % 100000}`,
        name: names('Double'),
        description: names('Two plans'),
        emoji: '✌️',
        rule: { type: 'count', fact: 'check_in', threshold: 999 },
      }).expect(201)
    ).body as AdminBadge;
    const challenge = (
      await post(admin, '/v1/admin/challenges', {
        title: names('Two plans this week'),
        description: names('Pull up twice'),
        emoji: '🔥',
        startsAt: new Date(Date.now() - H).toISOString(),
        endsAt: new Date(Date.now() + 7 * DAY).toISOString(),
        mode: 'solo',
        criteria: { target: 2 },
        rewardBadgeId: reward.id,
      }).expect(201)
    ).body as { id: string };
    const a = await member(h);
    const host = await verifiedMember(h);
    const joined = (await post(a, `/v1/challenges/${challenge.id}/join`).expect(200))
      .body as ChallengeList;
    expect(joined.items.find((c) => c.id === challenge.id)).toMatchObject({
      joined: true,
      progress: 0,
      state: 'active',
    });
    await checkIn(a, (await plot(h, host)).id);
    expect(
      ((await get(a, '/v1/challenges')).body as ChallengeList).items.find(
        (c) => c.id === challenge.id,
      )?.progress,
    ).toBe(1);
    await checkIn(a, (await plot(h, host)).id);
    const done = ((await get(a, '/v1/challenges')).body as ChallengeList).items.find(
      (c) => c.id === challenge.id,
    );
    expect(done).toMatchObject({ progress: 2 });
    expect(done?.completedAt).not.toBeNull();
    expect(await badgeKeys(a)).toContain(reward.key);
    const facts = await h.app
      .get(GamificationService)
      .facts(a.id, { kinds: ['challenge_completed'] });
    expect(facts.map((f) => f.ref)).toEqual([challenge.id]);
    await drain(['challenge.completed'], challenge.id);
    const adminView = (await get(admin, '/v1/admin/challenges').expect(200)).body.items as {
      id: string;
      participants: number;
      completed: number;
    }[];
    expect(adminView.find((c) => c.id === challenge.id)).toMatchObject({
      participants: 1,
      completed: 1,
    });
  });

  it('crew challenges pool the crew; new-places and with-squad rules; ended challenges are closed', async () => {
    const [interestId] = await interestIds(h, 1);
    const challenge = (
      await post(admin, '/v1/admin/challenges', {
        title: names('Crew explorers'),
        description: names('Two new spots with your squad'),
        emoji: '🧭',
        startsAt: new Date(Date.now() - H).toISOString(),
        endsAt: new Date(Date.now() + 7 * DAY).toISOString(),
        mode: 'group',
        criteria: { target: 2, newPlacesOnly: true, withSquad: true },
      }).expect(201)
    ).body as { id: string };
    const lead = await verifiedMember(h);
    const mate = await member(h);
    await befriend(h, lead, mate);
    await post(lead, `/v1/challenges/${challenge.id}/join`).expect(403);
    const crew = (await post(lead, '/v1/crews', { name: 'Explorers', interestId }).expect(201))
      .body as { id: string };
    await post(mate, `/v1/crews/${crew.id}/membership`, { action: 'join' }).expect(200);
    await post(lead, `/v1/crews/${crew.id}/members/${mate.id}`, { action: 'approve' }).expect(200);
    await post(lead, `/v1/challenges/${challenge.id}/join`, { crewId: crew.id }).expect(200);

    const host = await verifiedMember(h);
    // Together at one plan: counts (both squad, both there).
    const together = await plot(h, host);
    await checkIn(lead, together.id);
    await checkIn(mate, together.id);
    // Mate alone at another plan: no squad there, doesn't count.
    await checkIn(mate, (await plot(h, host)).id);
    const view = ((await get(lead, '/v1/challenges')).body as ChallengeList).items.find(
      (c) => c.id === challenge.id,
    );
    expect(view).toMatchObject({
      progress: 1,
      team: { crewId: crew.id, crewName: 'Explorers' },
      completedAt: null,
    });

    const ended = (
      await post(admin, '/v1/admin/challenges', {
        title: names('Old'),
        description: names('Old'),
        emoji: '⌛',
        startsAt: new Date(Date.now() - 3 * DAY).toISOString(),
        endsAt: new Date(Date.now() - DAY).toISOString(),
        mode: 'solo',
        criteria: { target: 1 },
      }).expect(201)
    ).body as { id: string; title: object };
    await post(lead, `/v1/challenges/${ended.id}/join`).expect(403);
    await put(admin, `/v1/admin/challenges/${ended.id}`, {
      title: names('Old'),
      description: names('Old'),
      emoji: '⌛',
      startsAt: new Date(Date.now() - 3 * DAY).toISOString(),
      endsAt: new Date(Date.now() - DAY).toISOString(),
      mode: 'solo',
      criteria: { target: 1 },
      active: false,
    }).expect(200);
    expect(
      ((await get(lead, '/v1/challenges')).body as ChallengeList).items.some(
        (c) => c.id === ended.id,
      ),
    ).toBe(false);
  });
});

// ---------- F-GAM-04 ----------

describe('recaps (F-GAM-04)', () => {
  it('the worker writes a recap for everyone who went out, once; only they can read it', async () => {
    const host = await verifiedMember(h);
    const [a, b, other] = [await member(h), await member(h), await member(h)];
    const plan = await plot(h, host);
    await checkIn(a, plan.id);
    await checkIn(b, plan.id);
    const key = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    const recaps = h.app.get(RecapsService);
    expect(await recaps.generate('month', key)).toBeGreaterThanOrEqual(2);
    expect(await recaps.generate('month', key)).toBe(0);
    const list = (await get(a, '/v1/me/recaps').expect(200)).body as RecapList;
    const mine = list.items.find((r) => r.key === key);
    if (!mine) throw new Error('recap missing');
    expect(mine.stats).toMatchObject({ eventsAttended: 1, peopleMet: 2 });
    expect(mine.stats.badges.map((x) => x.key)).toContain('grass_toucher');
    expect(mine.stats.topPeople.map((p) => p.id).sort()).toEqual([b.id, host.id].sort());
    await get(a, `/v1/me/recaps/${mine.id}`).expect(200);
    await get(other, `/v1/me/recaps/${mine.id}`).expect(404);
    await drain(['recap.ready'], a.id);
    const { rows } = await h.pool.query<{ notified_at: Date | null }>(
      'SELECT notified_at FROM recaps WHERE id = $1',
      [mine.id],
    );
    expect(rows[0]?.notified_at).not.toBeNull();
    expect(await recaps.generateDue(new Date())).toBeGreaterThanOrEqual(0);
  });
});

// ---------- F-GRW-01 ----------

async function approvedHost(): Promise<Member> {
  const m = await verifiedMember(h);
  const app = await post(m, '/v1/host/applications', {
    about: 'I run a weekend cycling group in Gachibowli.',
    experience: 'Hosted thirty rides for groups of ten to forty.',
    eventIdeas: 'Sunrise rides ending at a partner cafe.',
  }).expect(201);
  await request(h.http)
    .post(`/v1/admin/host-applications/${app.body.id as string}/review`)
    .set(...bearer(admin.token))
    .send({ decision: 'approved' })
    .expect(201);
  return m;
}

async function deliver(w: ReturnType<FakePaymentsGateway['simulateTransfer']>): Promise<void> {
  await request(h.http)
    .post('/v1/webhooks/razorpay')
    .set('content-type', 'application/json')
    .set('x-razorpay-signature', w.signature)
    .set('x-razorpay-event-id', w.eventId)
    .send(w.rawBody)
    .expect(200);
  await h.app.get(WebhooksService).process(w.eventId);
}

describe('referral rewards (F-GRW-01)', () => {
  it('a referral code gets a friend past the invite gate; their first check-in rewards the referrer once', async () => {
    const referrer = await member(h);
    const mine = (await get(referrer, '/v1/me/referrals').expect(200)).body as MyReferrals;
    expect(mine.code).toMatch(/^TG[A-Z0-9]{6}$/);
    expect(mine.link).toContain(`ref=${mine.code}`);
    expect(mine.perReferral).toEqual({ priorityPasses: 2, credits: 1 });
    expect((await get(referrer, '/v1/me/referrals')).body.code).toBe(mine.code);

    await setInviteGate(h, true);
    try {
      const s = await signIn(h, undefined, { inviteCode: mine.code.toLowerCase() });
      await onboard(h, s.accessToken);
      const friend: Member = { id: s.user.id, token: s.accessToken, phone: s.phone };
      const { rows } = await h.pool.query<{ invited_by_user_id: string }>(
        'SELECT invited_by_user_id FROM users WHERE id = $1',
        [friend.id],
      );
      expect(rows[0]?.invited_by_user_id).toBe(referrer.id);
      expect(
        ((await get(referrer, '/v1/me/referrals')).body as MyReferrals).items[0],
      ).toMatchObject({ status: 'pending', person: { id: friend.id } });

      const host = await verifiedMember(h);
      await checkIn(friend, (await plot(h, host)).id);
      await checkIn(friend, (await plot(h, host)).id);
      const after = (await get(referrer, '/v1/me/referrals')).body as MyReferrals;
      expect(after.items[0]?.status).toBe('rewarded');
      expect(after.balance).toEqual({ priorityPasses: 2, credits: 1, creditMaxPaise: 50_000 });
      await drain(['referral.rewarded'], referrer.id);
      expect(await badgeKeys(referrer)).toContain('plug');

      // Joining on the referrer's own phone earns nothing.
      const shared = device('Shared phone');
      const r2 = await signIn(h, undefined, { deviceInfo: shared });
      await onboard(h, r2.accessToken);
      const code2 = (
        await get({ id: r2.user.id, token: r2.accessToken, phone: r2.phone }, '/v1/me/referrals')
      ).body.code as string;
      await signIn(h, undefined, { inviteCode: code2, deviceInfo: shared });
      const own = (
        await get({ id: r2.user.id, token: r2.accessToken, phone: r2.phone }, '/v1/me/referrals')
      ).body as MyReferrals;
      expect(own.items[0]).toMatchObject({ status: 'rejected', reason: 'SAME_DEVICE' });

      // A number that was already rewarded can't be farmed again from a fresh account.
      await post(friend, '/v1/me/deletion', { confirm: 'DELETE' }).expect(202);
      await h.pool.query(
        "UPDATE users SET deletion_requested_at = now() - interval '30 days' WHERE id = $1",
        [friend.id],
      );
      const { AccountService } = await import('../src/modules/account/account.service.js');
      await h.app.get(AccountService).purgeDue();
      const again = await signIn(h, friend.phone, { inviteCode: code2 });
      await onboard(h, again.accessToken);
      await checkIn(
        { id: again.user.id, token: again.accessToken, phone: again.phone },
        (await plot(h, host)).id,
      );
      const farmed = (
        await get({ id: r2.user.id, token: r2.accessToken, phone: r2.phone }, '/v1/me/referrals')
      ).body as MyReferrals;
      expect(farmed.items.find((i) => i.person?.id === again.user.id)).toMatchObject({
        status: 'rejected',
        reason: 'DUPLICATE_PHONE',
      });
      expect(farmed.balance.priorityPasses).toBe(0);
    } finally {
      await setInviteGate(h, false);
    }
  });

  it('a priority pass jumps the waitlist (one pass, one jump, even when raced)', async () => {
    const host = await verifiedMember(h);
    const [seat, early, me] = [await member(h), await member(h), await member(h)];
    const plan = await plot(h, host, { capacity: 2 });
    const other = await plot(h, host, { capacity: 2 });
    await rsvp(h, seat, plan.id).expect(200);
    await rsvp(h, seat, other.id).expect(200);
    await rsvp(h, early, plan.id).expect(200);
    expect((await rsvp(h, me, plan.id).expect(200)).body.status).toBe('waitlisted');
    expect((await rsvp(h, me, other.id).expect(200)).body.status).toBe('waitlisted');
    await post(me, `/v1/events/${plan.id}/priority-pass`).expect(403);
    await h.pool.query(
      "INSERT INTO referral_rewards (id, user_id, kind, remaining) VALUES (uuid_v7(), $1, 'priority_pass', 1)",
      [me.id],
    );
    await post(me, `/v1/events/${(await plot(h, host)).id}/priority-pass`).expect(403); // not waitlisted there
    const [x, y] = await Promise.all([
      post(me, `/v1/events/${plan.id}/priority-pass`),
      post(me, `/v1/events/${other.id}/priority-pass`),
    ]);
    expect([x.status, y.status].sort()).toEqual([200, 403]);
    const ok = x.status === 200 ? x : y;
    expect(ok.body).toEqual({ position: 1 });
    expect(((await get(me, '/v1/me/referrals')).body as MyReferrals).balance.priorityPasses).toBe(
      0,
    );
  });

  it('a free entry pays for a paid plan; the credit returns on a full refund; the host is still paid', async () => {
    const host = await approvedHost();
    const plan = await plot(h, host, { pricePaise: 30_000 });
    const pricey = await plot(h, host, { pricePaise: 90_000 });
    const me = await member(h);
    await post(me, `/v1/events/${plan.id}/checkout`, { useCredit: true }).expect(403);
    await h.pool.query(
      "INSERT INTO referral_rewards (id, user_id, kind, remaining, max_paise) VALUES (uuid_v7(), $1, 'credit', 1, 50000)",
      [me.id],
    );
    const tooMuch = await post(me, `/v1/events/${pricey.id}/checkout`, { useCredit: true }).expect(
      403,
    );
    expect(tooMuch.body.error.details.reason).toBe('CREDIT_TOO_SMALL');
    const paid = await post(me, `/v1/events/${plan.id}/checkout`, { useCredit: true }).expect(201);
    expect(paid.body.kind).toBe('confirmed');
    const paymentId = paid.body.paymentId as string;
    const receipt = (await get(me, `/v1/payments/${paymentId}/receipt`).expect(200)).body;
    expect(receipt).toMatchObject({ method: 'credit', amountPaise: 30_000 });
    expect((await get(me, `/v1/events/${plan.id}`)).body.viewer.rsvp).toBe('going');
    expect(((await get(me, '/v1/me/referrals')).body as MyReferrals).balance.credits).toBe(0);

    // Cancelling well before the plan refunds in full: the free entry comes back.
    await request(h.http)
      .delete(`/v1/events/${plan.id}/rsvp`)
      .set(...bearer(me.token))
      .expect(204);
    const refundRow = await h.pool.query<{ id: string }>(
      'SELECT id FROM refunds WHERE payment_id = $1',
      [paymentId],
    );
    const refunds = h.app.get(RefundsService);
    if (refundRow.rows.length === 0) await refunds.onAttendeeCancelled(plan.id, me.id, new Date());
    for (const r of (
      await h.pool.query<{ id: string }>('SELECT id FROM refunds WHERE payment_id = $1', [
        paymentId,
      ])
    ).rows)
      await refunds.execute(r.id);
    expect(((await get(me, '/v1/me/referrals')).body as MyReferrals).balance.credits).toBe(1);
    const { rows } = await h.pool.query<{ status: string }>(
      'SELECT status FROM payments WHERE id = $1',
      [paymentId],
    );
    expect(rows[0]?.status).toBe('refunded');

    // Spent again and kept: after the plan, the host's share goes out from the platform balance.
    const kept = await post(me, `/v1/events/${plan.id}/checkout`, { useCredit: true }).expect(201);
    expect(kept.body.kind).toBe('confirmed');
    await h.pool.query(
      `UPDATE events SET status = 'completed', starts_at = now() - interval '3 days', ends_at = now() - interval '2 days' WHERE id = $1`,
      [plan.id],
    );
    await h.app.get(EventStore).invalidate(plan.id);
    const payouts = h.app.get(PayoutsService);
    await payouts.createDue();
    const account = await post(host, '/v1/host/account', {
      legalBusinessName: 'Host Co',
      contactName: 'Host',
      email: 'host@example.com',
    }).expect(201);
    expect(account.body.status).toBe('created');
    const acc = await h.pool.query<{ provider_account_id: string }>(
      'SELECT provider_account_id FROM host_accounts WHERE user_id = $1',
      [host.id],
    );
    const accountId = acc.rows[0]?.provider_account_id ?? '';
    await deliver(gateway.simulateAccount('activated', accountId));
    await payouts.executeDue();
    const sent = [...gateway.transfers.values()].filter((t) => t.providerAccountId === accountId);
    expect(sent).toHaveLength(1);
    expect(sent[0]).not.toHaveProperty('providerPaymentId');
    expect(sent[0]?.amountPaise).toBe(26_460); // 30 000 − 10% fee − 18% GST on the fee
  });
});
