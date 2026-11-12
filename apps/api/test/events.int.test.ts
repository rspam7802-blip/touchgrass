import type { EventDetail } from '@touchgrass/shared';
import { haversineMeters } from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CheckInService } from '../src/modules/events/check-in.service.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { WaitlistService } from '../src/modules/events/waitlist.service.js';
import { SEED_INVITE_CODE } from '../src/seed/seed.js';
import {
  ADDRESS,
  detail,
  idem,
  outboxFor,
  PLACE,
  planBody,
  plot,
  rsvp,
  shiftEvent,
  SPOT,
  verifiedMember,
  verify,
} from './event-helpers.js';
import {
  bearer,
  befriend,
  createHarness,
  device,
  freshPhone,
  fromIp,
  type Harness,
  member,
  type Member,
  onboard,
  requestOtp,
} from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});

const H = 3_600_000;

describe('plot (F-EVT-01/02)', () => {
  it('needs a verified host while the flag is on, then creates a published plan with the host going', async () => {
    const host = await member(h);
    const body = {
      title: 'Chai walk',
      categoryInterestId: (await request(h.http).get('/v1/interests')).body.items[0].id,
    };
    const unverified = await request(h.http)
      .post('/v1/events')
      .set(...bearer(host.token))
      .set(...idem())
      .send({
        ...body,
        where: { point: SPOT, address: ADDRESS },
        startsAt: new Date(Date.now() + 86_400_000).toISOString(),
        endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        capacity: 5,
      })
      .expect(403);
    expect(unverified.body.error.code).toBe('VERIFICATION_REQUIRED');
    await verify(h, host);
    const e = await plot(h, host);
    expect(e).toMatchObject({
      status: 'published',
      goingCount: 1,
      spotsLeft: 9,
      location: {
        kind: 'exact',
        point: SPOT,
        address: ADDRESS,
        placeName: PLACE,
        neighbourhoodName: 'Gachibowli',
      },
      viewer: { isHost: true, hostRole: 'host', rsvp: 'going', canRsvp: false },
      hosts: [
        expect.objectContaining({
          role: 'host',
          person: expect.objectContaining({ id: host.id }) as object,
        }),
      ],
    });
    expect(e.shareUrl).toMatch(new RegExp(`/e/${e.slug}$`));
    const created = await outboxFor(h, e.id, 'event.created');
    expect(created).toEqual([
      {
        eventId: e.id,
        creatorUserId: host.id,
        cityId: expect.any(String) as string,
        visibility: 'public',
      },
    ]);
  });

  it('rejects bad timing, places outside the city, paid plans, unknown interests and non-curators', async () => {
    const host = await verifiedMember(h, { gender: 'man' });
    const send = async (o: Record<string, unknown>) => {
      const { planBody } = await import('./event-helpers.js');
      return request(h.http)
        .post('/v1/events')
        .set(...bearer(host.token))
        .set(...idem())
        .send(await planBody(h, o));
    };
    expect(
      (
        await send({
          startsAt: new Date(Date.now() - H).toISOString(),
          endsAt: new Date(Date.now() + H).toISOString(),
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await send({
          startsAt: new Date(Date.now() + 200 * 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 200 * 86_400_000 + H).toISOString(),
        })
      ).status,
    ).toBe(400);
    expect(
      (await send({ where: { point: { lat: 13.08, lng: 80.27 }, address: 'Chennai' } })).status,
    ).toBe(400);
    // A city that is still on the waitlist isn't open for plans either (F-GRW-03).
    expect(
      (await send({ where: { point: { lat: 17.6868, lng: 83.2185 }, address: 'Visakhapatnam' } }))
        .status,
    ).toBe(400);
    expect((await send({ pricePaise: 50_000 })).body.error.details).toEqual({
      reason: 'PAID_NEEDS_HOST_APPROVAL',
    });
    expect(
      (await send({ categoryInterestId: '0192f3a4-5b6c-7d8e-9f01-23456789abcd' })).status,
    ).toBe(400);
    expect((await send({ type: 'curated' })).status).toBe(403);
    expect((await send({ smallGroup: true, capacity: 20 })).status).toBe(400);
    expect((await send({ visibility: 'balanced' })).status).toBe(400);
    expect((await send({ visibility: 'women_only' })).body.error.details).toEqual({
      reason: 'WOMEN_ONLY',
    });
  });

  it('drafts are host-only until published', async () => {
    const host = await verifiedMember(h);
    const other = await member(h);
    const e = await plot(h, host, { publish: false });
    expect(e.status).toBe('draft');
    await detail(h, other, e.id).expect(404);
    await request(h.http)
      .post(`/v1/events/${e.id}/publish`)
      .set(...bearer(host.token))
      .expect(200);
    await detail(h, other, e.id).expect(200);
    await request(h.http)
      .post(`/v1/events/${e.id}/publish`)
      .set(...bearer(host.token))
      .expect(409);
  });

  it('uses saved venues found through search', async () => {
    const host = await verifiedMember(h);
    const search = await request(h.http)
      .get('/v1/venues/search')
      .query({ q: 'mall', lat: SPOT.lat, lng: SPOT.lng, session: 'sess-1' })
      .set(...bearer(host.token))
      .expect(200);
    const placeId = search.body.places[0].placeId as string;
    const venue = await request(h.http)
      .post('/v1/venues/from-place')
      .set(...bearer(host.token))
      .send({ placeId, sessionToken: 'sess-1' })
      .expect(200);
    const again = await request(h.http)
      .post('/v1/venues/from-place')
      .set(...bearer(host.token))
      .send({ placeId, sessionToken: 'sess-1' })
      .expect(200);
    expect(again.body.id).toBe(venue.body.id);
    await request(h.http)
      .put(`/v1/venues/saved/${venue.body.id}`)
      .set(...bearer(host.token))
      .expect(204);
    expect(
      (
        await request(h.http)
          .get('/v1/venues/saved')
          .set(...bearer(host.token))
          .expect(200)
      ).body.items,
    ).toHaveLength(1);
    const e = await plot(h, host, { where: { venueId: venue.body.id } });
    expect(e.location).toMatchObject({
      kind: 'exact',
      placeName: venue.body.name,
      address: venue.body.address,
    });
    await request(h.http)
      .delete(`/v1/venues/saved/${venue.body.id}`)
      .set(...bearer(host.token))
      .expect(204);
  });
});

describe('visibility (F-EVT-03, F-SAF-03)', () => {
  it('friends-of-friends, invite-only, women-only and blocks', async () => {
    const host = await verifiedMember(h);
    const friend = await member(h);
    const fof = await member(h);
    const stranger = await member(h);
    await befriend(h, host, friend);
    await befriend(h, friend, fof);

    const fofPlan = await plot(h, host, { visibility: 'friends_of_friends' });
    await detail(h, friend, fofPlan.id).expect(200);
    await detail(h, fof, fofPlan.id).expect(200);
    await detail(h, stranger, fofPlan.id).expect(404);
    expect((await rsvp(h, stranger, fofPlan.id)).status).toBe(404);

    const secret = await plot(h, host, { visibility: 'invite_only' });
    await detail(h, friend, secret.id).expect(404);
    const inv = await request(h.http)
      .post(`/v1/events/${secret.id}/invites`)
      .set(...bearer(host.token))
      .send({ userIds: [friend.id, stranger.id] })
      .expect(200);
    expect(inv.body).toEqual({ invited: 1 });
    const seen = await detail(h, friend, secret.id).expect(200);
    expect(seen.body.viewer.invitedBy.id).toBe(host.id);
    await detail(h, stranger, secret.id).expect(404);
    // Attendees of invite-only plans cannot invite more people.
    await rsvp(h, friend, secret.id).expect(200);
    await request(h.http)
      .post(`/v1/events/${secret.id}/invites`)
      .set(...bearer(friend.token))
      .send({ userIds: [fof.id] })
      .expect(403);
    const outbox = await outboxFor(h, secret.id, 'event.invited');
    expect(outbox).toEqual([{ eventId: secret.id, inviterId: host.id, inviteeIds: [friend.id] }]);

    const woman = await verifiedMember(h, { gender: 'woman' });
    const unverifiedWoman = await member(h, { gender: 'woman' });
    const man = await verifiedMember(h, { gender: 'man' });
    const wo = await plot(h, woman, { visibility: 'women_only' });
    await detail(h, host, wo.id).expect(200); // the default test persona is a verified woman
    await detail(h, unverifiedWoman, wo.id).expect(404);
    await detail(h, man, wo.id).expect(404);

    // Men only mirrors women only (D-178): verified men see and join it, and only they can host it.
    const unverifiedMan = await member(h, { gender: 'man' });
    const otherMan = await verifiedMember(h, { gender: 'man' });
    const mo = await plot(h, man, { visibility: 'men_only' });
    await detail(h, otherMan, mo.id).expect(200);
    await rsvp(h, otherMan, mo.id).expect(200);
    await detail(h, unverifiedMan, mo.id).expect(404);
    await detail(h, woman, mo.id).expect(404);
    const refused = await request(h.http)
      .post('/v1/events')
      .set(...bearer(woman.token))
      .set(...idem())
      .send(await planBody(h, { visibility: 'men_only' }));
    expect(refused.status).toBe(403);
    expect(refused.body.error.details).toMatchObject({ reason: 'MEN_ONLY' });

    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(stranger.token))
      .set(...idem())
      .send({ userId: host.id })
      .expect(204);
    const pub = await plot(h, host);
    await detail(h, stranger, pub.id).expect(404);
    expect((await rsvp(h, stranger, pub.id)).status).toBe(404);
  });

  it('share-link invites open invite-only plans and record who invited you', async () => {
    const host = await verifiedMember(h);
    const guest = await member(h);
    const e = await plot(h, host, { visibility: 'invite_only' });
    const link = await request(h.http)
      .post(`/v1/events/${e.id}/invite-links`)
      .set(...bearer(host.token))
      .expect(201);
    const token = new URL(link.body.url as string).searchParams.get('i') ?? '';
    await request(h.http)
      .get(`/v1/events/by-slug/${e.slug}`)
      .set(...bearer(guest.token))
      .expect(404);
    await request(h.http)
      .get(`/v1/events/by-slug/${e.slug}`)
      .query({ i: 'x'.repeat(20) })
      .set(...bearer(guest.token))
      .expect(404);
    const opened = await request(h.http)
      .get(`/v1/events/by-slug/${e.slug}`)
      .query({ i: token })
      .set(...bearer(guest.token))
      .expect(200);
    expect(opened.body.viewer.invitedBy.id).toBe(host.id);
    await detail(h, guest, e.id).expect(200);
  });
});

describe('pull up, capacity and the waitlist (F-EVT-06/08)', () => {
  it('fills up, waitlists, offers a freed seat to the next in line and lets them claim it', async () => {
    const host = await verifiedMember(h);
    const [a, b, c, d] = [await member(h), await member(h), await member(h), await member(h)];
    const e = await plot(h, host, { capacity: 3 });
    expect((await rsvp(h, a, e.id).expect(200)).body.status).toBe('going');
    expect((await rsvp(h, a, e.id).expect(200)).body.status).toBe('going');
    await rsvp(h, b, e.id).expect(200);
    const full = await rsvp(h, c, e.id).expect(200);
    expect(full.body.status).toBe('waitlisted');
    expect(full.body.event.viewer).toMatchObject({
      rsvp: 'waitlisted',
      waitlistPosition: 1,
      canRsvp: false,
    });
    expect((await rsvp(h, d, e.id).expect(200)).body.event.viewer.waitlistPosition).toBe(2);
    expect((await detail(h, a, e.id)).body).toMatchObject({
      goingCount: 3,
      spotsLeft: 0,
      waitlistCount: 2,
    });

    await request(h.http)
      .delete(`/v1/events/${e.id}/rsvp`)
      .set(...bearer(a.token))
      .expect(204);
    const offered = await detail(h, c, e.id).expect(200);
    expect(offered.body.viewer.offer).toMatchObject({ mode: 'sequential' });
    // The freed seat is reserved for C: D and newcomers cannot take it.
    expect((await rsvp(h, d, e.id).expect(200)).body.status).toBe('waitlisted');
    expect(
      (
        await request(h.http)
          .post(`/v1/events/${e.id}/waitlist/claim`)
          .set(...bearer(d.token))
          .set(...idem())
          .expect(409)
      ).body.error.code,
    ).toBe('OFFER_EXPIRED');
    const claimed = await request(h.http)
      .post(`/v1/events/${e.id}/waitlist/claim`)
      .set(...bearer(c.token))
      .set(...idem())
      .expect(200);
    expect(claimed.body.status).toBe('going');
    expect(claimed.body.event.viewer.offer).toBeNull();
    expect((await outboxFor(h, e.id, 'waitlist.offered')).map((p) => p.userId)).toEqual([c.id]);
    expect((await outboxFor(h, e.id, 'rsvp.cancelled'))[0]).toMatchObject({
      userId: a.id,
      late: false,
      hadSeat: true,
    });
    await request(h.http)
      .delete(`/v1/events/${e.id}/rsvp`)
      .set(...bearer(host.token))
      .expect(409);
  });

  it('expired offers send the person to the back and the next one is offered', async () => {
    const host = await verifiedMember(h);
    const [a, b, c] = [await member(h), await member(h), await member(h)];
    const e = await plot(h, host, { capacity: 2 });
    await rsvp(h, a, e.id).expect(200);
    await rsvp(h, b, e.id).expect(200);
    await rsvp(h, c, e.id).expect(200);
    await request(h.http)
      .delete(`/v1/events/${e.id}/rsvp`)
      .set(...bearer(a.token))
      .expect(204);
    expect((await detail(h, b, e.id)).body.viewer.offer).not.toBeNull();
    await h.pool.query(
      "UPDATE waitlist_offers SET expires_at = now() - interval '1 second' WHERE event_id = $1 AND user_id = $2",
      [e.id, b.id],
    );
    await h.app.get(WaitlistService).sweep();
    expect((await detail(h, b, e.id)).body.viewer).toMatchObject({
      offer: null,
      waitlistPosition: 2,
    });
    expect((await detail(h, c, e.id)).body.viewer.offer).not.toBeNull();
  });

  it('in the last 6 h everyone waiting is told at once and the first claim wins', async () => {
    const host = await verifiedMember(h);
    const [a, b, c, d] = [await member(h), await member(h), await member(h), await member(h)];
    const e = await plot(h, host, { capacity: 2 });
    await rsvp(h, a, e.id).expect(200);
    for (const m of [b, c, d]) await rsvp(h, m, e.id).expect(200);
    await shiftEvent(h, e.id, 4 * H);
    await request(h.http)
      .delete(`/v1/events/${e.id}/rsvp`)
      .set(...bearer(a.token))
      .expect(204);
    const offers = await Promise.all(
      [b, c, d].map(
        async (m) => (await detail(h, m, e.id)).body.viewer.offer as { mode: string } | null,
      ),
    );
    expect(offers.every((o) => o?.mode === 'broadcast')).toBe(true);
    const claims = await Promise.all(
      [b, c, d].map((m) =>
        request(h.http)
          .post(`/v1/events/${e.id}/waitlist/claim`)
          .set(...bearer(m.token))
          .set(...idem()),
      ),
    );
    expect(claims.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      claims
        .filter((r) => r.status === 409)
        .map((r) => (r.body as { error: { code: string } }).error.code),
    ).toEqual(['OFFER_EXPIRED', 'OFFER_EXPIRED']);
    const { rows } = await h.pool.query(
      "SELECT count(*)::int AS n FROM waitlist_offers WHERE event_id = $1 AND status = 'open'",
      [e.id],
    );
    expect(rows[0].n).toBe(0);
    // Late cancel (within 3 h) is recorded for reliability.
    await shiftEvent(h, e.id, H);
    const winner = [b, c, d][claims.findIndex((r) => r.status === 200)] as Member;
    await request(h.http)
      .delete(`/v1/events/${e.id}/rsvp`)
      .set(...bearer(winner.token))
      .expect(204);
    expect((await outboxFor(h, e.id, 'rsvp.cancelled')).at(-1)).toMatchObject({
      userId: winner.id,
      late: true,
    });
  });

  it('never double-books the last spot under concurrent pull-ups (F-EVT-06)', async () => {
    const host = await verifiedMember(h);
    const e = await plot(h, host, { capacity: 2 });
    const crowd = await Promise.all(Array.from({ length: 25 }, () => member(h)));
    const results = await Promise.all(crowd.map((m) => rsvp(h, m, e.id)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.status === 'going')).toHaveLength(1);
    expect(results.filter((r) => r.body.status === 'waitlisted')).toHaveLength(24);
    const { rows } = await h.pool.query(
      "SELECT count(*)::int AS n FROM rsvps WHERE event_id = $1 AND status IN ('going','checked_in')",
      [e.id],
    );
    expect(rows[0].n).toBe(2);
  });

  it('balanced plans cap each verified-gender bucket', async () => {
    const host = await verifiedMember(h, { gender: 'man' });
    const e = await plot(h, host, { capacity: 4, visibility: 'balanced', balancedMaxSharePct: 50 });
    const man2 = await verifiedMember(h, { gender: 'man' });
    const man3 = await verifiedMember(h, { gender: 'man' });
    const woman = await verifiedMember(h, { gender: 'woman' });
    expect((await rsvp(h, man2, e.id).expect(200)).body.status).toBe('going');
    expect((await rsvp(h, man3, e.id).expect(200)).body.status).toBe('waitlisted');
    expect((await rsvp(h, woman, e.id).expect(200)).body.status).toBe('waitlisted');
  });

  it('interested is a soft signal that frees any seat', async () => {
    const host = await verifiedMember(h);
    const a = await member(h);
    const e = await plot(h, host);
    await rsvp(h, a, e.id).expect(200);
    const res = await rsvp(h, a, e.id, { status: 'interested' }).expect(200);
    expect(res.body).toMatchObject({ status: 'interested', event: { goingCount: 1 } });
  });
});

describe('+1s (F-EVT-07)', () => {
  it('brings a squad member, refuses strangers, and respects the host setting', async () => {
    const host = await verifiedMember(h);
    const [a, buddy, rando] = [await member(h), await member(h), await member(h)];
    await befriend(h, a, buddy);
    const closed = await plot(h, host);
    expect(
      (await rsvp(h, a, closed.id, { status: 'going', plusOne: { userId: buddy.id } }).expect(403))
        .body.error.details,
    ).toEqual({ reason: 'NO_PLUS_ONES' });
    const e = await plot(h, host, { allowPlusOnes: true, capacity: 4 });
    expect(
      (await rsvp(h, a, e.id, { status: 'going', plusOne: { userId: rando.id } }).expect(403)).body
        .error.details,
    ).toEqual({ reason: 'NOT_SQUAD' });
    const ok = await rsvp(h, a, e.id, { status: 'going', plusOne: { userId: buddy.id } }).expect(
      200,
    );
    expect(ok.body.event).toMatchObject({
      goingCount: 3,
      viewer: {
        plusOne: {
          kind: 'member',
          claimed: true,
          person: expect.objectContaining({ id: buddy.id }) as object,
        },
      },
    });
    expect((await detail(h, buddy, e.id)).body.viewer.rsvp).toBe('going');
    // Only one seat left: a +1 that needs two is refused, not silently dropped.
    const b = await member(h);
    const c = await member(h);
    await befriend(h, b, c);
    expect(
      (await rsvp(h, b, e.id, { status: 'going', plusOne: { userId: c.id } }).expect(409)).body
        .error.code,
    ).toBe('EVENT_FULL');
  });

  it('a guest +1 link lets a non-member sign up without an invite code and take the seat', async () => {
    const host = await verifiedMember(h);
    const a = await member(h);
    const e = await plot(h, host, { allowPlusOnes: true });
    const res = await rsvp(h, a, e.id, { status: 'going', plusOne: { guest: true } }).expect(200);
    expect(res.body.event).toMatchObject({
      goingCount: 3,
      viewer: { plusOne: { kind: 'guest', claimed: false } },
    });
    const url = res.body.plusOneClaimUrl as string;
    const token = url.split('/claim/')[1] ?? '';
    const preview = await request(h.http).get(`/v1/plus-ones/${token}`).expect(200);
    expect(preview.body).toMatchObject({
      inviterName: 'Test Person',
      event: { access: 'full', title: 'Sunset frisbee' },
    });
    expect(JSON.stringify(preview.body)).not.toContain(ADDRESS);

    const phone = freshPhone();
    const code = await requestOtp(h, phone);
    const signup = await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({ phone, code, claimToken: token, device: device() })
      .expect(200);
    expect(signup.body.isNewUser).toBe(true);
    await onboard(h, signup.body.accessToken as string);
    const guestView = await request(h.http)
      .get(`/v1/events/${e.id}`)
      .set(...bearer(signup.body.accessToken as string))
      .expect(200);
    expect(guestView.body).toMatchObject({ goingCount: 3, viewer: { rsvp: 'going' } });
    expect((await detail(h, a, e.id)).body.viewer.plusOne).toMatchObject({
      kind: 'member',
      claimed: true,
    });
    // Used links are gone; sign-up without invite or claim is still gated.
    await request(h.http).get(`/v1/plus-ones/${token}`).expect(404);
    const other = freshPhone();
    const otherCode = await requestOtp(h, other);
    await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({ phone: other, code: otherCode, claimToken: token, device: device() })
      .expect(403);
    await request(h.http)
      .post('/v1/auth/otp/verify')
      .set(...fromIp())
      .send({ phone: other, code: otherCode, inviteCode: SEED_INVITE_CODE, device: device() })
      .expect(200);
  });

  it('members can claim a guest link in the app', async () => {
    const host = await verifiedMember(h);
    const [a, friend] = [await member(h), await member(h)];
    const e = await plot(h, host, { allowPlusOnes: true });
    const res = await rsvp(h, a, e.id, { status: 'going', plusOne: { guest: true } }).expect(200);
    const token = (res.body.plusOneClaimUrl as string).split('/claim/')[1] ?? '';
    await request(h.http)
      .post('/v1/plus-ones/claim')
      .set(...bearer(a.token))
      .set(...idem())
      .send({ token })
      .expect(409);
    const claimed = await request(h.http)
      .post('/v1/plus-ones/claim')
      .set(...bearer(friend.token))
      .set(...idem())
      .send({ token })
      .expect(200);
    expect(claimed.body).toEqual({ eventId: e.id, slug: e.slug });
    expect((await detail(h, friend, e.id)).body.viewer.rsvp).toBe('going');
    // Cancelling an unclaimed guest seat releases it.
    const b = await member(h);
    const r2 = await rsvp(h, b, e.id, { status: 'going', plusOne: { guest: true } }).expect(200);
    expect(r2.body.event.goingCount).toBe(5);
    await request(h.http)
      .delete(`/v1/events/${e.id}/rsvp`)
      .set(...bearer(b.token))
      .expect(204);
    expect((await detail(h, a, e.id)).body.goingCount).toBe(3);
  });
});

describe('check-in (F-EVT-14)', () => {
  it('QR tickets scanned by hosts, inside the window only', async () => {
    const host = await verifiedMember(h);
    const [a, b] = [await member(h), await member(h)];
    const e = await plot(h, host);
    await request(h.http)
      .get(`/v1/events/${e.id}/ticket`)
      .set(...bearer(a.token))
      .expect(403);
    await rsvp(h, a, e.id).expect(200);
    const ticket = await request(h.http)
      .get(`/v1/events/${e.id}/ticket`)
      .set(...bearer(a.token))
      .expect(200);
    const scan = (by: Member, qr: string) =>
      request(h.http)
        .post(`/v1/events/${e.id}/check-in`)
        .set(...bearer(by.token))
        .send({ qr });
    expect((await scan(host, ticket.body.qr as string).expect(409)).body.error.details).toEqual({
      reason: 'WINDOW_CLOSED',
    });
    await shiftEvent(h, e.id, 10 * 60_000);
    expect((await detail(h, a, e.id)).body.viewer.canCheckIn).toBe(true);
    await scan(a, ticket.body.qr as string).expect(403);
    expect(
      (await scan(host, `${(ticket.body.qr as string).slice(0, -2)}00`).expect(409)).body.error
        .details,
    ).toEqual({ reason: 'INVALID_TICKET' });
    const ok = await scan(host, ticket.body.qr as string).expect(200);
    expect(ok.body).toMatchObject({ userId: a.id, method: 'qr', displayName: 'Test Person' });
    await scan(host, ticket.body.qr as string).expect(200);
    expect(await outboxFor(h, e.id, 'rsvp.checked_in')).toEqual([
      { eventId: e.id, userId: a.id, method: 'qr', onTime: true },
    ]);
    // Someone not going cannot be checked in, even with a validly signed ticket.
    const forged = h.app.get(CheckInService).ticketCode(e.id, b.id);
    expect((await scan(host, forged).expect(409)).body.error.details).toEqual({
      reason: 'NOT_GOING',
    });
    // Checked-in people cannot drop out afterwards.
    await request(h.http)
      .delete(`/v1/events/${e.id}/rsvp`)
      .set(...bearer(a.token))
      .expect(409);
  });

  it('self check-in inside the 150 m geofence', async () => {
    const host = await verifiedMember(h);
    const a = await member(h);
    const e = await plot(h, host);
    await rsvp(h, a, e.id).expect(200);
    await shiftEvent(h, e.id, -5 * 60_000);
    const at = (point: { lat: number; lng: number }) =>
      request(h.http)
        .post(`/v1/events/${e.id}/check-in`)
        .set(...bearer(a.token))
        .send({ point });
    expect(
      (await at({ lat: SPOT.lat + 0.01, lng: SPOT.lng }).expect(409)).body.error.details,
    ).toEqual({ reason: 'TOO_FAR' });
    expect((await at({ lat: SPOT.lat + 0.0005, lng: SPOT.lng }).expect(200)).body).toMatchObject({
      method: 'geofence',
    });
  });
});

describe('edit, hosts and cancel (F-EVT-13/14/16)', () => {
  it('a partial edit leaves everything it did not mention untouched', async () => {
    const host = await verifiedMember(h);
    const e = await plot(h, host, {
      visibility: 'friends_of_friends',
      mystery: true,
      soloFriendly: true,
      allowPlusOnes: true,
      description: 'Keep this',
      accessibility: { stepFree: true, accessibleRestroom: true, quietSpace: false },
    });
    const res = await request(h.http)
      .patch(`/v1/events/${e.id}`)
      .set(...bearer(host.token))
      .send({ title: 'Renamed' })
      .expect(200);
    expect(res.body).toMatchObject({
      title: 'Renamed',
      visibility: 'friends_of_friends',
      mystery: true,
      soloFriendly: true,
      allowPlusOnes: true,
      description: 'Keep this',
      accessibility: { stepFree: true, accessibleRestroom: true, quietSpace: false },
    });
  });

  it('co-hosts edit; material changes notify; capacity rules; cancel closes the plan', async () => {
    const host = await verifiedMember(h);
    const [co, a, b, c] = [await member(h), await member(h), await member(h), await member(h)];
    await befriend(h, host, co);
    const e = await plot(h, host, { capacity: 3 });
    await rsvp(h, a, e.id).expect(200);
    await request(h.http)
      .patch(`/v1/events/${e.id}`)
      .set(...bearer(a.token))
      .send({ title: 'Hijack' })
      .expect(403);
    const withCo = await request(h.http)
      .post(`/v1/events/${e.id}/hosts`)
      .set(...bearer(host.token))
      .send({ userId: co.id, role: 'co_host' })
      .expect(200);
    expect(withCo.body.hosts.map((x: { role: string }) => x.role)).toEqual(['host', 'co_host']);
    expect(withCo.body.goingCount).toBe(3);
    await request(h.http)
      .post(`/v1/events/${e.id}/hosts`)
      .set(...bearer(co.token))
      .send({ userId: b.id, role: 'welcome_host' })
      .expect(403);
    await rsvp(h, b, e.id).expect(200);
    expect((await rsvp(h, c, e.id).expect(200)).body.status).toBe('waitlisted');

    expect(
      (
        await request(h.http)
          .patch(`/v1/events/${e.id}`)
          .set(...bearer(co.token))
          .send({ capacity: 2 })
          .expect(409)
      ).body.error.details,
    ).toMatchObject({ reason: 'CAPACITY_BELOW_GOING' });
    await request(h.http)
      .patch(`/v1/events/${e.id}`)
      .set(...bearer(co.token))
      .send({ title: 'Sunset frisbee v2' })
      .expect(200);
    expect(await outboxFor(h, e.id, 'event.updated')).toEqual([]);
    const newStart = new Date(Date.now() + 4 * 86_400_000);
    await request(h.http)
      .patch(`/v1/events/${e.id}`)
      .set(...bearer(co.token))
      .send({
        startsAt: newStart.toISOString(),
        endsAt: new Date(newStart.getTime() + H).toISOString(),
        capacity: 5,
      })
      .expect(200);
    expect(await outboxFor(h, e.id, 'event.updated')).toEqual([
      { eventId: e.id, changes: ['startsAt', 'endsAt'], byUserId: co.id },
    ]);
    expect((await detail(h, c, e.id)).body.viewer.offer).not.toBeNull();

    await request(h.http)
      .delete(`/v1/events/${e.id}/hosts/${co.id}`)
      .set(...bearer(co.token))
      .expect(204);
    await request(h.http)
      .post(`/v1/events/${e.id}/cancel`)
      .set(...bearer(co.token))
      .set(...idem())
      .send({ reason: 'x' })
      .expect(403);
    const cancelled = await request(h.http)
      .post(`/v1/events/${e.id}/cancel`)
      .set(...bearer(host.token))
      .set(...idem())
      .send({ reason: 'Rain' })
      .expect(200);
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      cancelledReason: 'Rain',
      viewer: { canRsvp: false },
    });
    expect(await outboxFor(h, e.id, 'event.cancelled')).toEqual([
      { eventId: e.id, reason: 'Rain', byUserId: host.id, pricePaise: 0, wasPublished: true },
    ]);
    expect((await rsvp(h, c, e.id).expect(409)).body.error.code).toBe('EVENT_CLOSED');
    const { rows } = await h.pool.query(
      "SELECT count(*)::int AS n FROM waitlist_offers WHERE event_id = $1 AND status = 'open'",
      [e.id],
    );
    expect(rows[0].n).toBe(0);
  });

  it('completes ended plans and counts attendance on profiles', async () => {
    const host = await verifiedMember(h);
    const a = await member(h);
    const e = await plot(h, host);
    await rsvp(h, a, e.id).expect(200);
    await shiftEvent(h, e.id, -10 * 60_000, 20 * 60_000);
    await request(h.http)
      .post(`/v1/events/${e.id}/check-in`)
      .set(...bearer(a.token))
      .send({ point: SPOT })
      .expect(200);
    await h.pool.query("UPDATE events SET ends_at = now() - interval '1 minute' WHERE id = $1", [
      e.id,
    ]);
    expect(await h.app.get(EventsService).completeEnded()).toBeGreaterThanOrEqual(1);
    expect((await detail(h, a, e.id)).body.status).toBe('completed');
    const profile = await request(h.http)
      .get(`/v1/users/${a.id}/profile`)
      .set(...bearer(host.token))
      .expect(200);
    expect(profile.body.stats).toMatchObject({ eventsAttended: 1, reliabilityTier: 'new' });
    const hostProfile = await request(h.http)
      .get(`/v1/users/${host.id}/profile`)
      .set(...bearer(a.token))
      .expect(200);
    expect(hostProfile.body.stats.eventsHosted).toBe(1);
    const past = await request(h.http)
      .get('/v1/events/mine')
      .query({ scope: 'past' })
      .set(...bearer(a.token))
      .expect(200);
    expect(past.body.items.map((x: { id: string }) => x.id)).toContain(e.id);
  });
});

describe('who is going and my plans', () => {
  it('hides people who opted out (except to hosts) and flags first-timers', async () => {
    const host = await verifiedMember(h);
    const [shy, open] = [await member(h), await member(h)];
    await request(h.http)
      .put('/v1/me/settings/privacy')
      .set(...bearer(shy.token))
      .send({ showInWhoIsGoing: false })
      .expect(200);
    const e = await plot(h, host);
    await rsvp(h, shy, e.id).expect(200);
    await rsvp(h, open, e.id).expect(200);
    const asOpen = await request(h.http)
      .get(`/v1/events/${e.id}/attendees`)
      .set(...bearer(open.token))
      .expect(200);
    expect(asOpen.body.hiddenCount).toBe(1);
    expect(asOpen.body.items.map((x: { person: { id: string } }) => x.person.id).sort()).toEqual(
      [host.id, open.id].sort(),
    );
    expect(
      asOpen.body.items.find((x: { person: { id: string } }) => x.person.id === open.id),
    ).toMatchObject({ firstTime: true, isHost: false });
    const asHost = await request(h.http)
      .get(`/v1/events/${e.id}/attendees`)
      .set(...bearer(host.token))
      .expect(200);
    expect(asHost.body).toMatchObject({ hiddenCount: 0 });
    expect(asHost.body.items).toHaveLength(3);
  });

  it('lists upcoming and hosted plans with cursor pagination', async () => {
    const host = await verifiedMember(h);
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1)
      ids.push(
        (
          await plot(h, host, {
            startsAt: new Date(Date.now() + (i + 2) * 86_400_000).toISOString(),
            endsAt: new Date(Date.now() + (i + 2) * 86_400_000 + H).toISOString(),
          })
        ).id,
      );
    const page1 = await request(h.http)
      .get('/v1/events/mine')
      .query({ scope: 'hosting', limit: 2 })
      .set(...bearer(host.token))
      .expect(200);
    expect(page1.body.items.map((x: { id: string }) => x.id)).toEqual(ids.slice(0, 2));
    const page2 = await request(h.http)
      .get('/v1/events/mine')
      .query({ scope: 'hosting', limit: 2, cursor: page1.body.nextCursor })
      .set(...bearer(host.token))
      .expect(200);
    expect(page2.body).toMatchObject({
      items: [expect.objectContaining({ id: ids[2] }) as object],
      nextCursor: null,
    });
    const up = await request(h.http)
      .get('/v1/events/mine')
      .set(...bearer(host.token))
      .expect(200);
    expect(up.body.items).toHaveLength(3);
  });
});

describe('mystery plans never leak the spot (F-EVT-12)', () => {
  it('every surface shows only the approximate area until reveal, and only to people going', async () => {
    const host = await verifiedMember(h);
    const [going, waiting, outsider, friend] = [
      await member(h),
      await member(h),
      await member(h),
      await member(h),
    ];
    await befriend(h, going, friend);
    const e = await plot(h, host, { mystery: true, capacity: 2, mysteryRevealMinutesBefore: 60 });
    expect(e.location.kind).toBe('exact'); // hosts always know
    const leaks = (body: unknown) => {
      const s = JSON.stringify(body);
      return (
        s.includes(ADDRESS) ||
        s.includes(PLACE) ||
        s.includes(String(SPOT.lat)) ||
        s.includes(String(SPOT.lng))
      );
    };
    const go = await rsvp(h, going, e.id).expect(200);
    const wait = await rsvp(h, waiting, e.id).expect(200);
    expect(wait.body.status).toBe('waitlisted');
    const surfaces = [
      go.body,
      wait.body,
      (await detail(h, going, e.id)).body,
      (await detail(h, outsider, e.id)).body,
      (
        await request(h.http)
          .get(`/v1/events/by-slug/${e.slug}`)
          .set(...bearer(outsider.token))
      ).body,
      (
        await request(h.http)
          .get('/v1/events/mine')
          .set(...bearer(going.token))
      ).body,
      (
        await request(h.http)
          .get('/v1/events/mine')
          .set(...bearer(waiting.token))
      ).body,
      (
        await request(h.http)
          .get(`/v1/events/${e.id}/attendees`)
          .set(...bearer(going.token))
      ).body,
      (await request(h.http).get(`/v1/public/events/${e.slug}`)).body,
      (
        await request(h.http)
          .get(`/v1/events/${e.id}/ticket`)
          .set(...bearer(going.token))
      ).body,
      (
        await request(h.http)
          .get('/v1/activity')
          .set(...bearer(friend.token))
      ).body,
      (
        await request(h.http)
          .post(`/v1/events/${e.id}/check-in`)
          .set(...bearer(going.token))
          .send({ point: SPOT })
      ).body,
    ];
    for (const s of surfaces) expect(leaks(s)).toBe(false);
    const approx = (await detail(h, going, e.id)).body.location;
    expect(approx).toMatchObject({
      kind: 'approximate',
      radiusMeters: 2000,
      neighbourhoodName: 'Gachibowli',
    });
    expect(
      haversineMeters(approx.center as { lat: number; lng: number }, SPOT),
    ).toBeGreaterThanOrEqual(1000);
    expect(
      haversineMeters(approx.center as { lat: number; lng: number }, SPOT),
    ).toBeLessThanOrEqual(2000);
    // Same centre every time, so it cannot be averaged out.
    expect((await detail(h, outsider, e.id)).body.location.center).toEqual(approx.center);

    // Outbox payloads never carry it either.
    const { rows: outbox } = await h.pool.query<{ payload: unknown }>(
      'SELECT payload FROM outbox_events WHERE aggregate_id = $1',
      [e.id],
    );
    for (const r of outbox) expect(leaks(r.payload)).toBe(false);

    await shiftEvent(h, e.id, 50 * 60_000);
    const revealed = (await detail(h, going, e.id)).body;
    expect(revealed.location).toMatchObject({ kind: 'exact', address: ADDRESS, placeName: PLACE });
    for (const body of [
      (await detail(h, waiting, e.id)).body,
      (await detail(h, outsider, e.id)).body,
      (await request(h.http).get(`/v1/public/events/${e.slug}`)).body,
    ]) {
      expect(leaks(body)).toBe(false);
    }
    const geofenceBeforeWindow = await request(h.http)
      .post(`/v1/events/${e.id}/check-in`)
      .set(...bearer(going.token))
      .send({ point: SPOT });
    expect(geofenceBeforeWindow.body.error.details).toEqual({ reason: 'WINDOW_CLOSED' });
  });

  it('geofence probing is refused before reveal even inside the check-in window', async () => {
    const host = await verifiedMember(h);
    const going = await member(h);
    const e = await plot(h, host, { mystery: true, mysteryRevealMinutesBefore: 15 });
    await rsvp(h, going, e.id).expect(200);
    await shiftEvent(h, e.id, 25 * 60_000);
    const res = await request(h.http)
      .post(`/v1/events/${e.id}/check-in`)
      .set(...bearer(going.token))
      .send({ point: SPOT })
      .expect(409);
    expect(res.body.error.details).toEqual({ reason: 'NOT_REVEALED' });
  });

  it('the event cache never holds the exact spot', async () => {
    const host = await verifiedMember(h);
    const e = await plot(h, host, { mystery: true });
    await detail(h, await member(h), e.id).expect(200);
    const { Redis } = await import('ioredis');
    const { inject } = await import('vitest');
    const redis = new Redis(inject('redisUrl'));
    const cached = await redis.get(`cache:event:v3:${e.id}`);
    await redis.quit();
    expect(cached).not.toBeNull();
    expect(cached).not.toContain(ADDRESS);
    expect(cached).not.toContain(String(SPOT.lat));
  });
});

describe('share pages and reports (F-EVT-17, F-SAF-05)', () => {
  it('public view shows basics for open plans and a teaser for private ones', async () => {
    const host = await verifiedMember(h);
    const pub: EventDetail = await plot(h, host);
    const priv = await plot(h, host, { visibility: 'invite_only' });
    const draft = await plot(h, host, { publish: false });
    const full = await request(h.http).get(`/v1/public/events/${pub.slug}`).expect(200);
    expect(full.body).toMatchObject({
      access: 'full',
      title: 'Sunset frisbee',
      areaName: 'Gachibowli',
      hostName: 'Test Person',
      goingCount: 1,
    });
    expect(JSON.stringify(full.body)).not.toContain(ADDRESS);
    const teaser = await request(h.http).get(`/v1/public/events/${priv.slug}`).expect(200);
    expect(teaser.body).toEqual({
      access: 'teaser',
      slug: priv.slug,
      hostName: 'Test Person',
      startsAt: priv.startsAt,
      timezone: 'Asia/Kolkata',
      status: 'published',
    });
    await request(h.http).get(`/v1/public/events/${draft.slug}`).expect(404);
    await request(h.http).get('/v1/public/events/zzzzzzzz').expect(404);
  });

  it('events can be reported by people who can see them', async () => {
    const host = await verifiedMember(h);
    const [viewer, outsider] = [await member(h), await member(h)];
    const priv = await plot(h, host, { visibility: 'invite_only' });
    const pub = await plot(h, host);
    const report = (m: Member, id: string) =>
      request(h.http)
        .post('/v1/reports')
        .set(...bearer(m.token))
        .set(...idem())
        .send({ targetType: 'event', targetId: id, category: 'spam' });
    await report(viewer, pub.id).expect(201);
    await report(outsider, priv.id).expect(404);
  });
});

describe('account deletion (DPDP)', () => {
  it('cancels the host’s future plans and frees their seats', async () => {
    const host = await verifiedMember(h);
    const a = await member(h);
    const e = await plot(h, host);
    await rsvp(h, a, e.id).expect(200);
    const other = await plot(h, await verifiedMember(h));
    await rsvp(h, host, other.id).expect(200);
    const { AccountService } = await import('../src/modules/account/account.service.js');
    await request(h.http)
      .post('/v1/me/deletion')
      .set(...bearer(host.token))
      .set(...idem())
      .send({ confirm: 'DELETE' })
      .expect(202);
    await h.pool.query(
      "UPDATE users SET deletion_requested_at = now() - interval '30 days' WHERE id = $1",
      [host.id],
    );
    await h.app.get(AccountService).purgeDue();
    const after = (await detail(h, a, e.id)).body;
    expect(after).toMatchObject({
      status: 'cancelled',
      cancelledReason: 'The host left TouchGrass',
    });
    expect((await detail(h, a, other.id)).body.goingCount).toBe(1);
  });
});

describe('squad activity and the invite picker (F-SOC-04, F-EVT-04)', () => {
  it('feed shows plans only to squad who can see them; the picker shows invite status', async () => {
    const { DomainEventBus } = await import('../src/worker/domain-event-bus.js');
    const { EventActivityHandlers } =
      await import('../src/modules/events/event-activity.handlers.js');
    const host = await verifiedMember(h);
    const [pal, other] = [await member(h), await member(h)];
    await befriend(h, host, pal);
    await befriend(h, host, other);
    const open = await plot(h, host, { title: 'Open jam' });
    const secret = await plot(h, host, { title: 'Secret jam', visibility: 'invite_only' });
    await request(h.http)
      .post(`/v1/events/${secret.id}/invites`)
      .set(...bearer(host.token))
      .send({ userIds: [pal.id] })
      .expect(200);
    await rsvp(h, pal, secret.id).expect(200);

    const bus = new DomainEventBus();
    h.app.get(EventActivityHandlers).registerOn(bus);
    const { rows } = await h.pool.query<{
      id: string;
      aggregate_type: string;
      aggregate_id: string;
      event_type: string;
      payload: Record<string, unknown>;
      created_at: Date;
    }>(
      "SELECT * FROM outbox_events WHERE aggregate_id = ANY($1::uuid[]) AND event_type IN ('event.created', 'rsvp.going') ORDER BY created_at",
      [[open.id, secret.id]],
    );
    for (let pass = 0; pass < 2; pass += 1)
      for (const r of rows)
        await bus.dispatch({
          eventId: r.id,
          aggregateType: r.aggregate_type,
          aggregateId: r.aggregate_id,
          type: r.event_type,
          payload: r.payload,
          occurredAt: r.created_at.toISOString(),
        });

    const feed = async (m: Member) =>
      (
        (
          await request(h.http)
            .get('/v1/activity')
            .set(...bearer(m.token))
            .expect(200)
        ).body.items as { verb: string; object: { title: string } | null }[]
      )
        .filter((i) => i.object)
        .map((i) => `${i.verb}:${i.object?.title ?? ''}`);
    expect((await feed(pal)).sort()).toEqual(['plotted:Open jam', 'plotted:Secret jam']);
    expect(await feed(other)).toEqual(['plotted:Open jam']);

    const picker = await request(h.http)
      .get(`/v1/events/${secret.id}/invitees`)
      .set(...bearer(host.token))
      .expect(200);
    expect(picker.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          person: expect.objectContaining({ id: pal.id }) as object,
          invited: true,
          rsvp: 'going',
        }),
        expect.objectContaining({
          person: expect.objectContaining({ id: other.id }) as object,
          invited: false,
          rsvp: null,
        }),
      ]),
    );
    await request(h.http)
      .get(`/v1/events/${secret.id}/invitees`)
      .set(...bearer(pal.token))
      .expect(403);
  });
});
