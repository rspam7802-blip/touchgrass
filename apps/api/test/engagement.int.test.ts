import type { CrewDetail, CrewList, FreeNowList, ProposalDetail } from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AvailabilityHandlers } from '../src/modules/availability/availability.handlers.js';
import { AvailabilityService } from '../src/modules/availability/availability.service.js';
import { CrewsService } from '../src/modules/crews/crews.service.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { ProposalsService } from '../src/modules/proposals/proposals.service.js';
import {
  detail,
  idem,
  outboxFor,
  rsvp,
  shiftEvent,
  SPOT,
  verifiedMember,
} from './event-helpers.js';
import {
  befriend,
  bearer,
  createHarness,
  type Harness,
  interestIds,
  member,
  type Member,
} from './harness.js';

let h: Harness;
const H = 3_600_000;
const DAY = 24 * H;

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const api = (m: Member) => ({
  get: (path: string) =>
    request(h.http)
      .get(path)
      .set(...bearer(m.token)),
  post: (path: string, body?: object) =>
    request(h.http)
      .post(path)
      .set(...bearer(m.token))
      .set(...idem())
      .send(body ?? {}),
  put: (path: string, body: object) =>
    request(h.http)
      .put(path)
      .set(...bearer(m.token))
      .send(body),
  patch: (path: string, body: object) =>
    request(h.http)
      .patch(path)
      .set(...bearer(m.token))
      .send(body),
  del: (path: string) =>
    request(h.http)
      .delete(path)
      .set(...bearer(m.token)),
});

const where = { point: SPOT, address: 'KBR Park gate 1, Jubilee Hills', placeName: 'KBR Park' };

// ---------- F-ENG-01 ----------

describe("I'm free now (F-ENG-01)", () => {
  it('squad sees who is free; outsiders and blocked people do not; it expires', async () => {
    const [a, b, c, stranger] = [
      await member(h),
      await member(h),
      await member(h),
      await member(h),
    ];
    await befriend(h, a, b);
    await befriend(h, a, c);
    const set = await api(a)
      .put('/v1/me/availability', { hours: 3, note: 'chai near Madhapur?' })
      .expect(200);
    expect(new Date(set.body.until).getTime() - Date.now()).toBeGreaterThan(2.9 * H);
    // Only the first "free" tells the squad; editing the note doesn't re-notify.
    await api(a).put('/v1/me/availability', { hours: 4, note: 'actually biryani' }).expect(200);
    // The note is pushed to the squad, so flagged words are refused (D-163).
    await api(a).put('/v1/me/availability', { hours: 4, note: 'nee lanja' }).expect(400);
    expect(await outboxFor(h, a.id, 'availability.set')).toHaveLength(1);

    const seen = (await api(b).get('/v1/me/availability').expect(200)).body as FreeNowList;
    expect(seen.items.map((i) => i.person.id)).toEqual([a.id]);
    expect(seen.items[0]?.note).toBe('actually biryani');
    expect(seen.me).toEqual({ until: null, note: '' });
    expect(((await api(stranger).get('/v1/me/availability')).body as FreeNowList).items).toEqual(
      [],
    );

    await api(c).post('/v1/social/blocks', { userId: a.id }).expect(204);
    expect(((await api(c).get('/v1/me/availability')).body as FreeNowList).items).toEqual([]);
    expect(await h.app.get(AvailabilityService).audience(a.id)).toEqual([b.id]);
    expect(await h.app.get(AvailabilityHandlers).notify(a.id, '')).toBeGreaterThanOrEqual(0);

    await h.pool.query(
      "UPDATE availability_status SET until = now() - interval '1 minute' WHERE user_id = $1",
      [a.id],
    );
    expect(((await api(b).get('/v1/me/availability')).body as FreeNowList).items).toEqual([]);
    expect(await h.app.get(AvailabilityService).sweep()).toBeGreaterThanOrEqual(1);
    await api(a).put('/v1/me/availability', { hours: 1 }).expect(200);
    expect(await outboxFor(h, a.id, 'availability.set')).toHaveLength(2);
    await api(a).del('/v1/me/availability').expect(204);
    expect((await api(a).get('/v1/me/availability')).body.me.until).toBeNull();
    await api(a).put('/v1/me/availability', { hours: 7 }).expect(400);
  });
});

describe('pinging someone who is free now (F-ENG-01, Phase 13)', () => {
  it('pings a free squad member once per half hour and tells them who', async () => {
    const [a, b] = [await member(h), await member(h)];
    await befriend(h, a, b);
    await api(b).put('/v1/me/availability', { hours: 2 }).expect(200);

    await api(a).post(`/v1/availability/${b.id}/ping`).expect(204);
    expect(await outboxFor(h, b.id, 'availability.pinged')).toEqual([{ fromId: a.id, toId: b.id }]);
    // A second ping inside 30 minutes is refused and says when to try again.
    const again = await api(a).post(`/v1/availability/${b.id}/ping`).expect(429);
    expect(again.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    expect(await outboxFor(h, b.id, 'availability.pinged')).toHaveLength(1);

    // The worker step delivers it to b's inbox, naming a.
    expect(await h.app.get(AvailabilityHandlers).notifyPing(a.id, b.id)).toBeGreaterThanOrEqual(0);
    const inbox = (await api(b).get('/v1/notifications').expect(200)).body as {
      items: { kind: string; title: string }[];
    };
    const ping = inbox.items.find((i) => i.kind === 'free_now_ping');
    expect(ping?.title).toMatch(/wants to meet up$/);
  });

  it('never reaches people outside the squad, blocked people, or people no longer free', async () => {
    const [a, b, stranger, blocker] = [
      await member(h),
      await member(h),
      await member(h),
      await member(h),
    ];
    await befriend(h, a, b);
    await befriend(h, a, blocker);
    await api(stranger).put('/v1/me/availability', { hours: 2 }).expect(200);
    await api(blocker).put('/v1/me/availability', { hours: 2 }).expect(200);

    // b is in the squad but not free.
    const notFree = await api(a).post(`/v1/availability/${b.id}/ping`).expect(409);
    expect(notFree.body.error.code).toBe('NOT_FREE_NOW');
    // Strangers and blocks look the same: not found.
    await api(a).post(`/v1/availability/${stranger.id}/ping`).expect(404);
    await api(blocker).post('/v1/social/blocks', { userId: a.id }).expect(204);
    await api(a).post(`/v1/availability/${blocker.id}/ping`).expect(404);
    await api(a).post(`/v1/availability/${a.id}/ping`).expect(400);
    await api(a).post('/v1/availability/not-a-uuid/ping').expect(400);
    expect(await outboxFor(h, stranger.id, 'availability.pinged')).toEqual([]);
    expect(await outboxFor(h, blocker.id, 'availability.pinged')).toEqual([]);
    // A block that lands after the ping still stops the notification.
    expect(await h.app.get(AvailabilityHandlers).notifyPing(a.id, blocker.id)).toBe(0);
  });
});

// ---------- F-ENG-02 ----------

async function newCrew(admin: Member, body: Record<string, unknown> = {}): Promise<CrewDetail> {
  const [interestId] = await interestIds(h, 1);
  const res = await api(admin).post('/v1/crews', {
    name: 'Sunday Run Club',
    description: 'Easy 5k around KBR.',
    interestId,
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body as CrewDetail;
}

describe('crews in search (F-DSC-09)', () => {
  it('finds your crews and open ones, never invite-only crews you are not in', async () => {
    const admin = await verifiedMember(h);
    const outsider = await member(h);
    const tag = Math.random().toString(36).slice(2, 7);
    const open = await newCrew(admin, { name: `Lakeside walkers ${tag}` });
    const secret = await newCrew(admin, {
      name: `Lakeside poker ${tag}`,
      joinPolicy: 'invite_only',
    });
    const search = (m: Member) =>
      api(m).get(`/v1/discover/search?q=${encodeURIComponent(`lakeside ${tag}`)}&type=crews`);
    const forOutsider = (await search(outsider).expect(200)).body as { crews: { id: string }[] };
    expect(forOutsider.crews.map((c) => c.id)).toEqual([open.id]);
    const forAdmin = (await search(admin).expect(200)).body as { crews: { id: string }[] };
    expect(new Set(forAdmin.crews.map((c) => c.id))).toEqual(new Set([open.id, secret.id]));
    // A typo still finds it (trigram similarity), and "all" includes crews.
    const fuzzy = await api(outsider)
      .get(`/v1/discover/search?q=${encodeURIComponent(`Lakesid walkers ${tag}`)}`)
      .expect(200);
    expect((fuzzy.body as { crews: { id: string }[] }).crews.map((c) => c.id)).toContain(open.id);
    // Blocking the creator hides their crews.
    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(outsider.token))
      .send({ userId: admin.id })
      .expect((r) => expect([200, 201, 204]).toContain(r.status));
    expect(((await search(outsider).expect(200)).body as { crews: unknown[] }).crews).toEqual([]);
  });
});

describe('recurring crews (F-ENG-02)', () => {
  it('open crews are discoverable; requests are approved by admins; invite-only crews stay hidden', async () => {
    const admin = await verifiedMember(h);
    const [joiner, friend, outsider] = [await member(h), await member(h), await member(h)];
    const crew = await newCrew(admin);
    expect(crew).toMatchObject({
      memberCount: 1,
      canManage: true,
      viewer: { role: 'admin', status: 'active' },
    });

    const discover = (await api(joiner).get('/v1/crews?scope=discover').expect(200))
      .body as CrewList;
    expect(discover.items.map((c) => c.id)).toContain(crew.id);
    const asked = await api(joiner)
      .post(`/v1/crews/${crew.id}/membership`, { action: 'join' })
      .expect(200);
    expect(asked.body.viewer.status).toBe('requested');
    expect(await outboxFor(h, crew.id, 'crew.requested')).toHaveLength(1);
    // Asking twice is harmless; members-only things stay closed meanwhile.
    await api(joiner).post(`/v1/crews/${crew.id}/membership`, { action: 'join' }).expect(200);
    await api(joiner).get(`/v1/crews/${crew.id}/history`).expect(403);
    await api(joiner).get(`/v1/crews/${crew.id}/chat`).expect(404);

    const seenByAdmin = (await api(admin).get(`/v1/crews/${crew.id}`)).body as CrewDetail;
    expect(seenByAdmin.requests.map((r) => r.person.id)).toEqual([joiner.id]);
    await api(joiner)
      .post(`/v1/crews/${crew.id}/members/${admin.id}`, { action: 'remove' })
      .expect(403);
    const approved = await api(admin)
      .post(`/v1/crews/${crew.id}/members/${joiner.id}`, { action: 'approve' })
      .expect(200);
    expect(approved.body.memberCount).toBe(2);
    expect(await outboxFor(h, crew.id, 'crew.approved')).toHaveLength(1);
    const mine = (await api(joiner).get('/v1/crews?scope=mine').expect(200)).body as CrewList;
    expect(mine.items[0]).toMatchObject({
      id: crew.id,
      viewer: { role: 'member', status: 'active' },
    });

    // Crew chat: members only.
    const chat = await api(joiner).get(`/v1/crews/${crew.id}/chat`).expect(200);
    expect(chat.body).toMatchObject({ kind: 'crew', title: 'Sunday Run Club' });

    // Invite-only: invisible to outsiders, joinable by the invited.
    const secret = await newCrew(admin, { name: 'Night owls', joinPolicy: 'invite_only' });
    await api(outsider).get(`/v1/crews/${secret.id}`).expect(404);
    await api(outsider).post(`/v1/crews/${secret.id}/membership`, { action: 'join' }).expect(404);
    await befriend(h, admin, friend);
    const invited = await api(admin)
      .post(`/v1/crews/${secret.id}/invites`, { userIds: [friend.id, outsider.id] })
      .expect(200);
    expect(invited.body).toEqual({ invited: 1 }); // only squad can be invited
    expect((await api(friend).get(`/v1/crews/${secret.id}`).expect(200)).body.viewer.status).toBe(
      'invited',
    );
    await api(friend).post(`/v1/crews/${secret.id}/membership`, { action: 'accept' }).expect(200);
    await api(friend)
      .post(`/v1/crews/${secret.id}/members/${admin.id}`, { action: 'make_member' })
      .expect(403);

    // Roles: the last admin can't leave while others remain, or step down.
    await api(admin).post(`/v1/crews/${secret.id}/membership`, { action: 'leave' }).expect(403);
    await api(admin)
      .post(`/v1/crews/${secret.id}/members/${admin.id}`, { action: 'make_member' })
      .expect(403);
    await api(admin)
      .post(`/v1/crews/${secret.id}/members/${friend.id}`, { action: 'make_admin' })
      .expect(200);
    await api(admin).post(`/v1/crews/${secret.id}/membership`, { action: 'leave' }).expect(200);
    await api(friend)
      .post(`/v1/crews/${secret.id}/members/${friend.id}`, { action: 'remove' })
      .expect(404);
    await api(friend)
      .patch(`/v1/crews/${secret.id}`, { description: 'Late runs only.' })
      .expect(200);
    await api(friend).post(`/v1/crews/${secret.id}/membership`, { action: 'leave' }).expect(200);
    // The last person out archives it.
    await api(friend).get(`/v1/crews/${secret.id}`).expect(404);
  });

  it('a schedule generates invite-only sessions for members; newcomers get invited; history counts attendance', async () => {
    const admin = await verifiedMember(h);
    const [runner, latecomer, outsider] = [await member(h), await member(h), await member(h)];
    const crew = await newCrew(admin);
    await api(runner).post(`/v1/crews/${crew.id}/membership`, { action: 'join' }).expect(200);
    await api(admin)
      .post(`/v1/crews/${crew.id}/members/${runner.id}`, { action: 'approve' })
      .expect(200);
    const startsAt = new Date(Math.ceil((Date.now() + 2 * DAY) / H) * H);
    await api(runner)
      .put(`/v1/crews/${crew.id}/schedule`, {
        rrule: 'FREQ=WEEKLY',
        startsAt: startsAt.toISOString(),
        durationMinutes: 90,
        where,
        capacity: 20,
      })
      .expect(403);
    const scheduled = await api(admin)
      .put(`/v1/crews/${crew.id}/schedule`, {
        rrule: 'FREQ=WEEKLY',
        startsAt: startsAt.toISOString(),
        durationMinutes: 90,
        where,
        capacity: 20,
      })
      .expect(200);
    const crewView = scheduled.body as CrewDetail;
    expect(crewView.recurrence).toMatchObject({
      rrule: 'FREQ=WEEKLY',
      placeLabel: 'KBR Park',
      active: true,
    });
    expect(crewView.upcoming.map((s) => s.startsAt)).toEqual([
      startsAt.toISOString(),
      new Date(startsAt.getTime() + 7 * DAY).toISOString(),
    ]);
    const [first, second] = crewView.upcoming;
    if (!first || !second) throw new Error('sessions missing');
    // Generating again creates nothing new.
    expect(await h.app.get(CrewsService).generate(crew.id)).toBe(0);
    expect(
      await h.app.get(CrewsService).generateDue(new Date(Date.now() + 10 * DAY)),
    ).toBeGreaterThanOrEqual(0);

    const session = (await detail(h, runner, first.eventId).expect(200)).body;
    expect(session).toMatchObject({
      type: 'crew_session',
      visibility: 'invite_only',
      crew: { id: crew.id, name: 'Sunday Run Club' },
    });
    await detail(h, outsider, first.eventId).expect(404);

    await api(latecomer).post(`/v1/crews/${crew.id}/membership`, { action: 'join' }).expect(200);
    await api(admin)
      .post(`/v1/crews/${crew.id}/members/${latecomer.id}`, { action: 'approve' })
      .expect(200);
    await detail(h, latecomer, second.eventId).expect(200);

    // The runner pulls up and checks in; the session ends.
    await rsvp(h, runner, first.eventId).expect(200);
    await h.pool.query(
      "UPDATE rsvps SET status = 'checked_in', checked_in_at = now() WHERE event_id = $1 AND user_id = $2",
      [first.eventId, runner.id],
    );
    await shiftEvent(h, first.eventId, -4 * H);
    await h.pool.query(
      "UPDATE crew_sessions SET occurrence_at = now() - interval '4 hours' WHERE event_id = $1",
      [first.eventId],
    );
    await h.app.get(EventsService).completeEnded();
    const history = await api(runner).get(`/v1/crews/${crew.id}/history`).expect(200);
    expect(history.body).toMatchObject({
      attendedCount: 1,
      items: [{ eventId: first.eventId, attended: true, checkedInCount: 1 }],
    });
    const members = ((await api(admin).get(`/v1/crews/${crew.id}`)).body as CrewDetail).members;
    expect(members.find((m) => m.person.id === runner.id)?.attended).toBe(1);

    // Changing the schedule drops the uncommitted upcoming session and makes new ones.
    const moved = new Date(startsAt.getTime() + DAY);
    const rescheduled = (
      await api(admin)
        .put(`/v1/crews/${crew.id}/schedule`, {
          rrule: 'FREQ=WEEKLY',
          startsAt: moved.toISOString(),
          durationMinutes: 60,
          where,
          capacity: 12,
          title: 'Sunday 5k',
        })
        .expect(200)
    ).body as CrewDetail;
    expect(rescheduled.upcoming.every((s) => s.startsAt !== second.startsAt)).toBe(true);
    expect((await detail(h, latecomer, second.eventId)).body.status).toBe('cancelled');
    await api(admin)
      .put(`/v1/crews/${crew.id}/schedule`, {
        rrule: 'FREQ=YEARLY',
        startsAt: moved.toISOString(),
        durationMinutes: 60,
        where,
        capacity: 12,
      })
      .expect(400);
  });
});

// ---------- F-ENG-03 ----------

describe('collaborative plans (F-ENG-03)', () => {
  it('invitees suggest and vote; the organiser locks it into an invite-only plan', async () => {
    const organiser = await verifiedMember(h);
    const [friend, other, outsider] = [await member(h), await member(h), await member(h)];
    await befriend(h, organiser, friend);
    await befriend(h, organiser, other);
    const [categoryInterestId] = await interestIds(h, 1);
    const start = new Date(Date.now() + 3 * DAY).toISOString();
    const created = await api(organiser).post('/v1/proposals', {
      title: 'Board games?',
      categoryInterestId,
      inviteeIds: [friend.id, other.id, outsider.id],
      deadline: new Date(Date.now() + DAY).toISOString(),
      options: [
        { kind: 'time', startsAt: start, durationMinutes: 120 },
        { kind: 'place', where },
      ],
    });
    expect(created.status).toBe(201);
    const p = created.body as ProposalDetail;
    expect(p.invitees.map((i) => i.id).sort()).toEqual([friend.id, other.id].sort());
    expect(p).toMatchObject({ status: 'open', canLock: true, viewerIsCreator: true });
    expect(await outboxFor(h, p.id, 'proposal.invited')).toHaveLength(1);
    await api(outsider).get(`/v1/proposals/${p.id}`).expect(404);

    const later = new Date(Date.now() + 4 * DAY).toISOString();
    const withOption = (
      await api(friend)
        .post(`/v1/proposals/${p.id}/options`, {
          kind: 'time',
          startsAt: later,
          durationMinutes: 90,
        })
        .expect(201)
    ).body as ProposalDetail;
    const laterOption = withOption.options.find((o) => o.startsAt === later);
    if (!laterOption) throw new Error('option missing');
    await api(friend)
      .post(`/v1/proposals/${p.id}/options`, { kind: 'activity', label: 'Catan' })
      .expect(201);
    await api(friend)
      .post(`/v1/proposals/${p.id}/options`, {
        kind: 'time',
        startsAt: new Date(Date.now() - H).toISOString(),
        durationMinutes: 90,
      })
      .expect(400);
    const voted = (
      await api(friend)
        .post(`/v1/proposals/${p.id}/votes`, { optionId: laterOption.id, vote: true })
        .expect(200)
    ).body as ProposalDetail;
    expect(voted.options.find((o) => o.id === laterOption.id)).toMatchObject({
      votes: 1,
      mine: true,
    });
    await api(other)
      .post(`/v1/proposals/${p.id}/votes`, { optionId: laterOption.id, vote: true })
      .expect(200);
    await api(other)
      .post(`/v1/proposals/${p.id}/votes`, { optionId: laterOption.id, vote: false })
      .expect(200);
    expect((await api(friend).get('/v1/proposals')).body.items[0]).toMatchObject({
      id: p.id,
      optionCount: 4,
    });

    const place = voted.options.find((o) => o.kind === 'place');
    const activity = voted.options.find((o) => o.kind === 'activity');
    if (!place || !activity) throw new Error('options missing');
    await api(friend)
      .post(`/v1/proposals/${p.id}/lock`, { timeOptionId: laterOption.id, placeOptionId: place.id })
      .expect(403);
    await api(organiser)
      .post(`/v1/proposals/${p.id}/lock`, { timeOptionId: place.id, placeOptionId: place.id })
      .expect(403);
    const locked = (
      await api(organiser)
        .post(`/v1/proposals/${p.id}/lock`, {
          timeOptionId: laterOption.id,
          placeOptionId: place.id,
          activityOptionId: activity.id,
        })
        .expect(200)
    ).body as ProposalDetail;
    expect(locked.status).toBe('locked');
    if (!locked.eventId) throw new Error('no event');
    const plan = (await detail(h, friend, locked.eventId).expect(200)).body;
    expect(plan).toMatchObject({
      title: 'Board games? · Catan',
      visibility: 'invite_only',
      startsAt: later,
    });
    await detail(h, outsider, locked.eventId).expect(404);
    expect(await outboxFor(h, p.id, 'proposal.locked')).toHaveLength(1);
    await api(friend)
      .post(`/v1/proposals/${p.id}/votes`, { optionId: place.id, vote: true })
      .expect(403);
  });

  it('at the deadline: auto-lock picks the most-voted options, or closes without a plan', async () => {
    const organiser = await verifiedMember(h);
    const friend = await member(h);
    await befriend(h, organiser, friend);
    const [categoryInterestId] = await interestIds(h, 1);
    const deadline = new Date(Date.now() + H);
    const t1 = new Date(Date.now() + 3 * DAY).toISOString();
    const t2 = new Date(Date.now() + 5 * DAY).toISOString();
    const auto = (
      await api(organiser)
        .post('/v1/proposals', {
          title: 'Chai run',
          categoryInterestId,
          inviteeIds: [friend.id],
          deadline: deadline.toISOString(),
          options: [
            { kind: 'time', startsAt: t1, durationMinutes: 60 },
            { kind: 'time', startsAt: t2, durationMinutes: 60 },
            { kind: 'place', where },
          ],
        })
        .expect(201)
    ).body as ProposalDetail;
    const t2Option = auto.options.find((o) => o.startsAt === t2);
    if (!t2Option) throw new Error('missing');
    await api(friend)
      .post(`/v1/proposals/${auto.id}/votes`, { optionId: t2Option.id, vote: true })
      .expect(200);
    const empty = (
      await api(organiser)
        .post('/v1/proposals', {
          title: 'Something?',
          categoryInterestId,
          inviteeIds: [friend.id],
          deadline: deadline.toISOString(),
        })
        .expect(201)
    ).body as ProposalDetail;
    const manual = (
      await api(organiser)
        .post('/v1/proposals', {
          title: 'Manual',
          categoryInterestId,
          deadline: deadline.toISOString(),
          autoLock: false,
        })
        .expect(201)
    ).body as ProposalDetail;
    await api(organiser)
      .post('/v1/proposals', {
        title: 'Too soon',
        categoryInterestId,
        deadline: new Date(Date.now() + 60_000).toISOString(),
      })
      .expect(400);

    expect(
      await h.app.get(ProposalsService).lockDue(new Date(deadline.getTime() + 60_000)),
    ).toBeGreaterThanOrEqual(1);
    const after = (await api(friend).get(`/v1/proposals/${auto.id}`)).body as ProposalDetail;
    expect(after.status).toBe('locked');
    if (!after.eventId) throw new Error('no event');
    expect((await detail(h, friend, after.eventId)).body.startsAt).toBe(t2);
    expect((await api(organiser).get(`/v1/proposals/${empty.id}`)).body).toMatchObject({
      status: 'cancelled',
      cancelledReason: 'NO_OPTIONS',
    });
    expect((await api(organiser).get(`/v1/proposals/${manual.id}`)).body.status).toBe('open');
    const cancelled = await api(organiser).post(`/v1/proposals/${manual.id}/cancel`).expect(200);
    expect(cancelled.body).toMatchObject({ status: 'cancelled', cancelledReason: 'BY_CREATOR' });
  });
});

describe('account data (Phase 8 engagement)', () => {
  it('free-now, crews and proposals are exported, then erased with the account', async () => {
    const a = await verifiedMember(h);
    const friend = await member(h);
    await befriend(h, a, friend);
    await api(a).put('/v1/me/availability', { hours: 2 }).expect(200);
    const crew = await newCrew(a, { name: 'Export crew' });
    await api(friend).post(`/v1/crews/${crew.id}/membership`, { action: 'join' }).expect(200);
    await api(a)
      .post(`/v1/crews/${crew.id}/members/${friend.id}`, { action: 'approve' })
      .expect(200);
    const [categoryInterestId] = await interestIds(h, 1);
    await api(a)
      .post('/v1/proposals', {
        title: 'Export plan',
        categoryInterestId,
        deadline: new Date(Date.now() + DAY).toISOString(),
      })
      .expect(201);
    const exported = JSON.stringify((await api(a).get('/v1/me/export').expect(200)).body);
    for (const needle of ['Export crew', 'Export plan', '"availability"'])
      expect(exported).toContain(needle);

    await api(a).post('/v1/me/deletion', { confirm: 'DELETE' }).expect(202);
    await h.pool.query(
      "UPDATE users SET deletion_requested_at = now() - interval '30 days' WHERE id = $1",
      [a.id],
    );
    const { AccountService } = await import('../src/modules/account/account.service.js');
    await h.app.get(AccountService).purgeDue();
    const { rows } = await h.pool.query<Record<string, number>>(
      `SELECT (SELECT count(*)::int FROM availability_status WHERE user_id = $1) AS free,
              (SELECT count(*)::int FROM crew_members WHERE user_id = $1) AS crews,
              (SELECT count(*)::int FROM plan_proposals WHERE creator_id = $1) AS proposals`,
      [a.id],
    );
    expect(rows[0]).toEqual({ free: 0, crews: 0, proposals: 0 });
    // The crew carries on with its remaining member as admin.
    const view = (await api(friend).get(`/v1/crews/${crew.id}`).expect(200)).body as CrewDetail;
    expect(view).toMatchObject({ memberCount: 1, viewer: { role: 'admin' } });
  });
});
