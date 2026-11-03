import type {
  AdminFeedbackRow,
  AttendeeList,
  EventAnalytics,
  EventDetail,
  FeedbackSummary,
  LoreAlbum,
  PostEventCard,
  PublicProfile,
  ReconnectList,
} from '@touchgrass/shared';
import { LIMITS } from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventStore } from '../src/modules/events/event-store.service.js';
import { EventsService } from '../src/modules/events/events.service.js';
import { LoreHandlers } from '../src/modules/lore/lore.handlers.js';
import { LoreService } from '../src/modules/lore/lore.service.js';
import { MediaProcessor } from '../src/modules/media/media.processor.js';
import { ReliabilityHandlers } from '../src/modules/reliability/reliability.handlers.js';
import { ReliabilityService } from '../src/modules/reliability/reliability.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { DomainEventBus } from '../src/worker/domain-event-bus.js';
import { detail, idem, plot, rsvp, shiftEvent, verifiedMember } from './event-helpers.js';
import {
  befriend,
  bearer,
  createHarness,
  fromIp,
  type Harness,
  member,
  type Member,
  onboard,
  signIn,
  testJpeg,
} from './harness.js';

let h: Harness;
let admin: Member;
const H = 3_600_000;

beforeAll(async () => {
  h = await createHarness();
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

/** A plan the guests pulled up to and checked in at, which ended `endedHoursAgo` ago. */
async function attendedPlan(
  host: Member,
  guests: Member[],
  opts: { endedHoursAgo?: number; noShows?: Member[]; capacity?: number } = {},
): Promise<string> {
  const plan = await plot(h, host, { capacity: opts.capacity ?? 10 });
  for (const g of [...guests, ...(opts.noShows ?? [])]) await rsvp(h, g, plan.id).expect(200);
  for (const g of guests)
    await h.pool.query(
      `UPDATE rsvps SET status = 'checked_in', checked_in_at = now() - interval '3 hours', check_in_method = 'qr'
       WHERE event_id = $1 AND user_id = $2`,
      [plan.id, g.id],
    );
  const ended = opts.endedHoursAgo ?? 1;
  await shiftEvent(h, plan.id, -(ended + 2) * H, 2 * H);
  return plan.id;
}

async function drain(types: string[], aggregateId: string): Promise<void> {
  const bus = new DomainEventBus();
  h.app.get(LoreHandlers).registerOn(bus);
  h.app.get(ReliabilityHandlers).registerOn(bus);
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
  for (const r of rows)
    await bus.dispatch({
      eventId: r.id,
      aggregateType: r.aggregate_type,
      aggregateId: r.aggregate_id,
      type: r.event_type,
      payload: r.payload,
      occurredAt: r.created_at.toISOString(),
    });
}

async function lorePhoto(m: Member, process = true): Promise<string> {
  const body = await testJpeg(800, 600, true);
  const created = await request(h.http)
    .post('/v1/media/uploads')
    .set(...bearer(m.token))
    .send({ purpose: 'lore', contentType: 'image/jpeg', sizeBytes: body.length })
    .expect(201);
  const id = created.body.assetId as string;
  h.storage.simulateUpload(created.body.upload.fields.key as string, body, 'image/jpeg');
  await request(h.http)
    .post(`/v1/media/${id}/complete`)
    .set(...bearer(m.token))
    .expect(200);
  if (process) await h.app.get(MediaProcessor).process(id);
  return id;
}

const feedback = (m: Member, eventId: string, body: Record<string, unknown>) =>
  request(h.http)
    .put(`/v1/events/${eventId}/feedback`)
    .set(...bearer(m.token))
    .send(body);

// ---------- F-AFT-02 / F-AFT-05 ----------

describe('feedback and host ratings (F-AFT-02, F-AFT-05)', () => {
  it('only people who checked in rate a finished plan, for two weeks', async () => {
    const host = await verifiedMember(h);
    const [a, b] = [await member(h), await member(h)];
    const live = await plot(h, host);
    await rsvp(h, a, live.id).expect(200);
    await h.pool.query(
      `UPDATE rsvps SET status = 'checked_in' WHERE event_id = $1 AND user_id = $2`,
      [live.id, a.id],
    );
    await shiftEvent(h, live.id, -H, 2 * H);
    expect((await feedback(a, live.id, { rating: 5 }).expect(403)).body.error.details.reason).toBe(
      'NOT_YET',
    );

    const id = await attendedPlan(host, [a]);
    await rsvp(h, b, id).expect(409);
    expect((await feedback(b, id, { rating: 5 }).expect(403)).body.error.details.reason).toBe(
      'NOT_ATTENDED',
    );
    expect((await feedback(host, id, { rating: 5 }).expect(403)).body.error.details.reason).toBe(
      'HOST',
    );
    const mine = await feedback(a, id, {
      rating: 4,
      hostRating: 5,
      great: ['welcoming', 'welcoming', 'great_people'],
      improve: ['started_late'],
      comment: 'Loved it, start on time next time',
    }).expect(200);
    expect(mine.body).toMatchObject({
      rating: 4,
      hostRating: 5,
      great: ['welcoming', 'great_people'],
    });
    const again = await feedback(a, id, { rating: 3, hostRating: null }).expect(200);
    expect(again.body).toMatchObject({ rating: 3, hostRating: null, great: [], comment: '' });

    const old = await attendedPlan(host, [a], { endedHoursAgo: 15 * 24 });
    expect((await feedback(a, old, { rating: 5 }).expect(403)).body.error.details.reason).toBe(
      'FEEDBACK_CLOSED',
    );
  });

  it('hosts see the aggregate; comments only once three people answered, never with names', async () => {
    const host = await verifiedMember(h);
    const guests = [await member(h), await member(h), await member(h)];
    const id = await attendedPlan(host, guests);
    await feedback(guests[0] as Member, id, {
      rating: 5,
      hostRating: 5,
      great: ['welcoming'],
      comment: 'Brilliant',
    }).expect(200);
    await feedback(guests[1] as Member, id, {
      rating: 4,
      hostRating: 4,
      great: ['welcoming'],
      improve: ['too_loud'],
    }).expect(200);
    const two = (
      await request(h.http)
        .get(`/v1/events/${id}/feedback/summary`)
        .set(...bearer(host.token))
        .expect(200)
    ).body as FeedbackSummary;
    expect(two).toMatchObject({ count: 2, averageRating: 4.5, hostAverage: 4.5, comments: [] });
    await feedback(guests[2] as Member, id, {
      rating: 3,
      hostRating: 4,
      comment: 'Too loud for me',
    }).expect(200);
    const three = (
      await request(h.http)
        .get(`/v1/events/${id}/feedback/summary`)
        .set(...bearer(host.token))
        .expect(200)
    ).body as FeedbackSummary;
    expect(three).toMatchObject({ count: 3, averageRating: 4, hostAverage: 4.3, hostCount: 3 });
    expect(three.great).toEqual([{ tag: 'welcoming', count: 2 }]);
    expect(three.comments.map((c) => c.comment).sort()).toEqual(['Brilliant', 'Too loud for me']);
    expect(JSON.stringify(three)).not.toContain(guests[0]?.id ?? 'x');
    await request(h.http)
      .get(`/v1/events/${id}/feedback/summary`)
      .set(...bearer((guests[0] as Member).token))
      .expect(403);

    // Host insights (Phase 6) now read ratings and themes from feedback.
    const insights = (
      await request(h.http)
        .get(`/v1/host/analytics/events/${id}`)
        .set(...bearer(host.token))
        .expect(200)
    ).body as EventAnalytics;
    expect(insights).toMatchObject({ averageRating: 4, ratingsCount: 3 });
    expect(insights.themes[0]).toEqual({ theme: 'welcoming', count: 2 });

    // Profiles show the host rating once there are three ratings.
    const profile = (
      await request(h.http)
        .get(`/v1/users/${host.id}/profile`)
        .set(...bearer((guests[0] as Member).token))
        .expect(200)
    ).body as PublicProfile;
    expect(profile.hostRating).toEqual({ average: 4.3, count: 3 });
    const unrated = await verifiedMember(h);
    expect(
      (
        (
          await request(h.http)
            .get(`/v1/users/${unrated.id}/profile`)
            .set(...bearer(host.token))
            .expect(200)
        ).body as PublicProfile
      ).hostRating,
    ).toBeNull();

    const lowest = await request(h.http)
      .get('/v1/admin/feedback?sort=lowest')
      .set(...bearer(admin.token))
      .expect(200);
    const row = (lowest.body.items as AdminFeedbackRow[]).find((r) => r.eventId === id);
    expect(row).toMatchObject({
      count: 3,
      averageRating: 4,
      topImprove: [{ tag: 'too_loud', count: 1 }],
    });
    await request(h.http)
      .get('/v1/admin/feedback')
      .set(...bearer(host.token))
      .expect(403);
  });
});

// ---------- F-AFT-03 / F-AFT-01 ----------

describe('reconnect and the post-event card (F-AFT-01, F-AFT-03)', () => {
  it('a mutual pull makes people squad; blocks and outsiders are excluded', async () => {
    const host = await verifiedMember(h);
    const [a, b, c, outsider] = [
      await member(h),
      await member(h),
      await member(h),
      await member(h),
    ];
    const id = await attendedPlan(host, [a, b, c]);
    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(a.token))
      .send({ userId: c.id })
      .expect(204);
    const list = (
      await request(h.http)
        .get(`/v1/events/${id}/people`)
        .set(...bearer(a.token))
        .expect(200)
    ).body as ReconnectList;
    expect(list.items.map((p) => p.person.id).sort()).toEqual([b.id, host.id].sort());
    expect(list.items.every((p) => p.state === 'none')).toBe(true);
    expect(
      (
        await request(h.http)
          .get(`/v1/events/${id}/people`)
          .set(...bearer(outsider.token))
          .expect(403)
      ).body.error.details.reason,
    ).toBe('NOT_ATTENDED');

    const pull = (m: Member, t: Member) =>
      request(h.http)
        .post(`/v1/events/${id}/people/${t.id}/pull`)
        .set(...bearer(m.token));
    expect((await pull(a, b).expect(200)).body).toEqual({ state: 'pulled' });
    const bView = (
      await request(h.http)
        .get(`/v1/events/${id}/people`)
        .set(...bearer(b.token))
        .expect(200)
    ).body as ReconnectList;
    expect(bView.items.find((p) => p.person.id === a.id)?.state).toBe('pulled_you');
    expect((await pull(b, a).expect(200)).body).toEqual({ state: 'squad' });
    expect(
      (
        (
          await request(h.http)
            .get(`/v1/users/${b.id}/profile`)
            .set(...bearer(a.token))
            .expect(200)
        ).body as PublicProfile
      ).relationship,
    ).toBe('squad');
    await pull(a, c).expect(404);
    await pull(a, outsider).expect(404);
  });

  it('shows the latest attended plan until dismissed', async () => {
    const host = await verifiedMember(h);
    const a = await member(h);
    const older = await attendedPlan(host, [a], { endedHoursAgo: 30 });
    const newer = await attendedPlan(host, [a], { endedHoursAgo: 2 });
    const first = (
      await request(h.http)
        .get('/v1/me/after')
        .set(...bearer(a.token))
        .expect(200)
    ).body as {
      card: PostEventCard | null;
    };
    expect(first.card?.event.id).toBe(newer);
    expect(first.card).toMatchObject({
      feedback: null,
      loreCount: 0,
      canAddLore: true,
      badges: [],
    });
    expect(first.card?.host?.id).toBe(host.id);
    await request(h.http)
      .post(`/v1/events/${newer}/after/dismiss`)
      .set(...bearer(a.token))
      .expect(204);
    const second = (
      await request(h.http)
        .get('/v1/me/after')
        .set(...bearer(a.token))
        .expect(200)
    ).body as {
      card: PostEventCard | null;
    };
    expect(second.card?.event.id).toBe(older);
    await request(h.http)
      .post(`/v1/events/${older}/after/dismiss`)
      .set(...bearer(a.token))
      .expect(204);
    expect(
      (
        await request(h.http)
          .get('/v1/me/after')
          .set(...bearer(a.token))
          .expect(200)
      ).body,
    ).toEqual({ card: null });
    // Still reachable from the plan itself.
    await request(h.http)
      .get(`/v1/events/${older}/after`)
      .set(...bearer(a.token))
      .expect(200);
  });
});

// ---------- F-AFT-04 ----------

describe('Lore albums (F-AFT-04)', () => {
  it('attendees add moderated photos; squads see them only when the host allows; blocks hide uploaders', async () => {
    const host = await verifiedMember(h);
    const [a, b, friend, outsider] = [
      await member(h),
      await member(h),
      await member(h),
      await member(h),
    ];
    await befriend(h, a, friend);
    const id = await attendedPlan(host, [a, b]);
    const album = (m: Member) =>
      request(h.http)
        .get(`/v1/events/${id}/lore`)
        .set(...bearer(m.token));
    const add = (m: Member, mediaId: string, caption = '') =>
      request(h.http)
        .post(`/v1/events/${id}/lore`)
        .set(...bearer(m.token))
        .send({ mediaId, caption });

    await album(outsider).expect(404);
    await album(friend).expect(404);
    expect(((await detail(h, outsider, id).expect(200)).body as EventDetail).lore).toBeNull();

    const unprocessed = await lorePhoto(a, false);
    expect((await add(a, unprocessed).expect(409)).body.error.code).toBe('MEDIA_NOT_READY');
    const pa = await lorePhoto(a);
    const pb = await lorePhoto(b);
    const itemA = (await add(a, pa, 'Golden hour').expect(201)).body.id as string;
    await add(b, pb).expect(201);
    await add(a, pa).expect(409);
    await add(outsider, await lorePhoto(outsider)).expect(404);
    const profilePhoto = await request(h.http)
      .post('/v1/media/uploads')
      .set(...bearer(a.token))
      .send({ purpose: 'profile_photo', contentType: 'image/jpeg', sizeBytes: 10 })
      .expect(201);
    await add(a, profilePhoto.body.assetId as string).expect(400);

    const seen = (await album(b).expect(200)).body as LoreAlbum;
    expect(seen).toMatchObject({
      count: 2,
      canAdd: true,
      canManage: false,
      visibility: 'attendees',
    });
    expect(seen.items.find((i) => i.id === itemA)).toMatchObject({
      caption: 'Golden hour',
      mine: false,
    });
    expect(((await detail(h, a, id).expect(200)).body as EventDetail).lore).toEqual({
      count: 2,
      canAdd: true,
    });

    // Squads of attendees once the host opens it up; they can look but not add.
    await request(h.http)
      .put(`/v1/events/${id}/lore/visibility`)
      .set(...bearer(a.token))
      .send({ visibility: 'friends_of_attendees' })
      .expect(403);
    await request(h.http)
      .put(`/v1/events/${id}/lore/visibility`)
      .set(...bearer(host.token))
      .send({ visibility: 'friends_of_attendees' })
      .expect(204);
    expect(((await album(friend).expect(200)).body as LoreAlbum).canAdd).toBe(false);
    await add(friend, await lorePhoto(friend)).expect(403);
    await album(outsider).expect(404);

    // Blocks: B never sees A's photos, nor downloads them.
    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(b.token))
      .send({ userId: a.id })
      .expect(204);
    const blockedView = (await album(b).expect(200)).body as LoreAlbum;
    expect(blockedView.items.map((i) => i.uploader.id)).toEqual([b.id]);
    const dl = await request(h.http)
      .get(`/v1/events/${id}/lore/download`)
      .set(...bearer(b.token))
      .expect(200);
    expect(dl.body.items).toHaveLength(1);
    await request(h.http)
      .get(`/v1/events/${id}/lore/download`)
      .set(...bearer(outsider.token))
      .expect(404);

    // Reports: viewers can report a photo, outsiders cannot even find it.
    await request(h.http)
      .post('/v1/reports')
      .set(...bearer(friend.token))
      .set(...idem())
      .send({ targetType: 'lore_media', targetId: itemA, category: 'nudity' })
      .expect(201);
    await request(h.http)
      .post('/v1/reports')
      .set(...bearer(outsider.token))
      .set(...idem())
      .send({ targetType: 'lore_media', targetId: itemA, category: 'nudity' })
      .expect(404);

    // Removal: uploaders their own, hosts anyone's; others cannot.
    await request(h.http)
      .delete(`/v1/lore/${itemA}`)
      .set(...bearer(friend.token))
      .expect(404);
    await request(h.http)
      .delete(`/v1/lore/${itemA}`)
      .set(...bearer(host.token))
      .expect(204);
    expect(((await album(a).expect(200)).body as LoreAlbum).count).toBe(1);
  });

  it('draws a cover collage from the newest photos, only when they change', async () => {
    const host = await verifiedMember(h);
    const a = await member(h);
    const id = await attendedPlan(host, [a]);
    for (let i = 0; i < 3; i += 1)
      await request(h.http)
        .post(`/v1/events/${id}/lore`)
        .set(...bearer(a.token))
        .send({ mediaId: await lorePhoto(a) })
        .expect(201);
    await drain(['lore.added'], id);
    const withCover = (
      await request(h.http)
        .get(`/v1/events/${id}/lore`)
        .set(...bearer(a.token))
        .expect(200)
    ).body as LoreAlbum;
    expect(withCover.cover?.lg).toMatch(/^http/);
    expect(await h.app.get(LoreService).refreshCover(id)).toBe(false);
    const { rows } = await h.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM activity_events WHERE actor_id = $1 AND verb = 'lore_posted' AND object_id = $2`,
      [a.id, id],
    );
    expect(rows[0]?.n).toBe(1);
  });
});

// ---------- F-SAF-02 ----------

describe('reliability (F-SAF-02)', () => {
  it('outcomes come from finished plans; repeat no-shows sit out popular plans; hosts see tiers', async () => {
    const host = await verifiedMember(h);
    const [flake, steady] = [await member(h), await member(h)];
    for (let i = 0; i < 2; i += 1) {
      const plan = await plot(h, host);
      await rsvp(h, flake, plan.id).expect(200);
      await rsvp(h, steady, plan.id).expect(200);
      await h.pool.query(
        `UPDATE rsvps SET status = 'checked_in', checked_in_at = now() - interval '3 hours' WHERE event_id = $1 AND user_id = $2`,
        [plan.id, steady.id],
      );
      await shiftEvent(h, plan.id, -5 * H, 2 * H);
      await h.app.get(EventsService).completeEnded();
      await drain(['event.completed'], plan.id);
    }
    const { rows } = await h.pool.query<{ tier: string; cooldown_until: Date | null }>(
      'SELECT tier, cooldown_until FROM reliability_scores WHERE user_id = $1',
      [flake.id],
    );
    expect(rows[0]?.cooldown_until).not.toBeNull();
    expect(await h.app.get(ReliabilityService).recomputeAll()).toBeGreaterThanOrEqual(2);

    // Popular (nearly full) plan: refused with the reason and date; a roomy one is fine.
    const popular = await plot(h, host, { capacity: 3 });
    await rsvp(h, steady, popular.id).expect(200);
    const view = (await detail(h, flake, popular.id).expect(200)).body as EventDetail;
    expect(view.viewer).toMatchObject({ canRsvp: false, blockedReason: 'RELIABILITY_COOLDOWN' });
    expect(view.viewer.cooldownUntil).not.toBeNull();
    const refused = await rsvp(h, flake, popular.id).expect(403);
    expect(refused.body.error.details.reason).toBe('RELIABILITY_COOLDOWN');
    const roomy = await plot(h, host, { capacity: 20 });
    await rsvp(h, flake, roomy.id).expect(200);

    const asHost = (
      await request(h.http)
        .get(`/v1/events/${roomy.id}/attendees`)
        .set(...bearer(host.token))
        .expect(200)
    ).body as AttendeeList;
    expect(asHost.items.find((a) => a.person.id === flake.id)?.reliabilityTier).toBe('new');
    const asGuest = (
      await request(h.http)
        .get(`/v1/events/${roomy.id}/attendees`)
        .set(...bearer(flake.token))
        .expect(200)
    ).body as AttendeeList;
    expect(asGuest.items.every((a) => a.reliabilityTier === null)).toBe(true);
  });

  it('late cancellations count; tiers show on profiles after three commitments', async () => {
    const host = await verifiedMember(h);
    const p = await member(h);
    for (let i = 0; i < 3; i += 1) {
      const plan = await plot(h, host);
      await rsvp(h, p, plan.id).expect(200);
      await h.pool.query(
        `UPDATE rsvps SET status = 'checked_in', checked_in_at = now() - interval '3 hours' WHERE event_id = $1 AND user_id = $2`,
        [plan.id, p.id],
      );
      await shiftEvent(h, plan.id, -5 * H, 2 * H);
      await h.app.get(EventsService).completeEnded();
      await drain(['event.completed'], plan.id);
    }
    const profile = (
      await request(h.http)
        .get(`/v1/users/${p.id}/profile`)
        .set(...bearer(host.token))
        .expect(200)
    ).body as PublicProfile;
    expect(profile.stats.reliabilityTier).toBe('super_reliable');

    const soon = await plot(h, host);
    await rsvp(h, p, soon.id).expect(200);
    await shiftEvent(h, soon.id, 2 * H, 2 * H);
    await request(h.http)
      .delete(`/v1/events/${soon.id}/rsvp`)
      .set(...bearer(p.token))
      .expect(204);
    await drain(['rsvp.cancelled'], soon.id);
    const { rows } = await h.pool.query<{ kind: string }>(
      'SELECT kind FROM reliability_events WHERE user_id = $1 AND event_id = $2',
      [p.id, soon.id],
    );
    expect(rows.map((r) => r.kind)).toEqual(['late_cancel']);
    await h.app.get(EventStore).invalidate(soon.id);
    const after = (
      await request(h.http)
        .get(`/v1/users/${p.id}/profile`)
        .set(...bearer(host.token))
        .expect(200)
    ).body as PublicProfile;
    expect(after.stats.reliabilityTier).toBe('reliable');
  });
});

// ---------- concurrency and account data ----------

describe('Lore limit under concurrency (F-AFT-04)', () => {
  it('racing uploads past the per-person limit: exactly one more photo lands', async () => {
    const host = await verifiedMember(h);
    const a = await member(h);
    const id = await attendedPlan(host, [a]);
    // Fill the album to one below the limit with copies of a processed photo (processing 29 images is slow).
    const template = await lorePhoto(a);
    await h.pool.query(
      `WITH copies AS (
         INSERT INTO media_assets
         SELECT r.* FROM generate_series(1, $3::int) g,
           LATERAL jsonb_populate_record(null::media_assets,
             (SELECT to_jsonb(m) || jsonb_build_object('id', gen_random_uuid(), 'original_key', m.original_key || '/copy/' || g)
              FROM media_assets m WHERE m.id = $1)) r
         RETURNING id)
       INSERT INTO lore_items (event_id, media_id, uploader_id) SELECT $2, id, $4 FROM copies`,
      [template, id, LIMITS.after.lorePerPersonPerEvent - 1, a.id],
    );
    const media = await Promise.all([lorePhoto(a), lorePhoto(a), lorePhoto(a)]);
    const results = await Promise.all(
      media.map((mediaId) =>
        request(h.http)
          .post(`/v1/events/${id}/lore`)
          .set(...bearer(a.token))
          .send({ mediaId, caption: '' }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 403, 403]);
    for (const r of results.filter((x) => x.status === 403))
      expect(r.body.error.details.reason).toBe('LORE_LIMIT');
    const { rows } = await h.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM lore_items WHERE event_id = $1 AND uploader_id = $2 AND status = 'visible'`,
      [id, a.id],
    );
    expect(rows[0]?.n).toBe(LIMITS.after.lorePerPersonPerEvent);
  });
});

describe('account data (after the event)', () => {
  it('feedback, ratings, pulls, Lore and reliability are exported, then erased with the account', async () => {
    const host = await verifiedMember(h);
    const [a, b] = [await member(h), await member(h)];
    const id = await attendedPlan(host, [a, b]);
    await feedback(a, id, { rating: 4, hostRating: 5, comment: 'export me' }).expect(200);
    await request(h.http)
      .post(`/v1/events/${id}/people/${b.id}/pull`)
      .set(...bearer(a.token))
      .expect(200);
    const added = await request(h.http)
      .post(`/v1/events/${id}/lore`)
      .set(...bearer(a.token))
      .send({ mediaId: await lorePhoto(a), caption: 'mine' })
      .expect(201);
    await h.app.get(EventsService).completeEnded();
    await drain(['event.completed'], id);

    const exported = JSON.stringify(
      (
        await request(h.http)
          .get('/v1/me/export')
          .set(...bearer(a.token))
          .expect(200)
      ).body,
    );
    for (const needle of ['export me', '"hostRatingsGiven"', b.id, added.body.id, '"check_in"'])
      expect(exported).toContain(needle);

    await request(h.http)
      .post('/v1/me/deletion')
      .set(...bearer(a.token))
      .set(...idem())
      .send({ confirm: 'DELETE' })
      .expect(202);
    await h.pool.query(
      "UPDATE users SET deletion_requested_at = now() - interval '30 days' WHERE id = $1",
      [a.id],
    );
    const { AccountService } = await import('../src/modules/account/account.service.js');
    await h.app.get(AccountService).purgeDue();
    const { rows } = await h.pool.query<Record<string, number>>(
      `SELECT
         (SELECT count(*)::int FROM event_feedback WHERE user_id = $1) AS feedback,
         (SELECT count(*)::int FROM host_ratings WHERE rater_id = $1) AS ratings,
         (SELECT count(*)::int FROM reconnect_pulls WHERE from_user_id = $1 OR to_user_id = $1) AS pulls,
         (SELECT count(*)::int FROM lore_items WHERE uploader_id = $1) AS lore,
         (SELECT count(*)::int FROM reliability_events WHERE user_id = $1) AS outcomes,
         (SELECT count(*)::int FROM reliability_scores WHERE user_id = $1) AS scores`,
      [a.id],
    );
    expect(rows[0]).toEqual({ feedback: 0, ratings: 0, pulls: 0, lore: 0, outcomes: 0, scores: 0 });
  });
});
