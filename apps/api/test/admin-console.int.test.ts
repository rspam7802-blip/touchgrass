import type { FeedItem } from '@touchgrass/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AnalyticsCountersService } from '../src/modules/analytics/analytics-counters.service.js';
import { UsersService } from '../src/modules/users/users.service.js';
import { SEED_ADMIN_PHONE } from '../src/seed/seed.js';
import { idem, outboxFor, planBody, plot, verifiedMember } from './event-helpers.js';
import {
  bearer,
  cityAndHood,
  createHarness,
  fromIp,
  type Harness,
  member,
  type Member,
  signIn,
} from './harness.js';

let h: Harness;
let admin: string;
let hyderabad: string;
let bengaluru: string;

const suffix = () => Math.random().toString(36).slice(2, 8);

/** A member holding a staff role (re-signed in so the token carries it). */
async function staff(
  role: 'city_curator' | 'support' | 'moderator' | 'admin',
  cityId: string | null = null,
): Promise<Member> {
  const m = await member(h);
  await h.app.get(UsersService).grantRole(m.id, role, cityId);
  const s = await signIn(h, m.phone, { inviteCode: null });
  return { ...m, token: s.accessToken };
}

async function auditCount(action: string): Promise<number> {
  const { rows } = await h.pool.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM admin_actions WHERE action = $1',
    [action],
  );
  return rows[0]?.n ?? 0;
}

beforeAll(async () => {
  h = await createHarness();
  admin = (await signIn(h, SEED_ADMIN_PHONE, { inviteCode: null })).accessToken;
  hyderabad = (await cityAndHood(h)).cityId;
  const { rows } = await h.pool.query<{ id: string }>(
    "SELECT id FROM cities WHERE slug = 'bengaluru'",
  );
  bengaluru = rows[0]?.id ?? '';
});
afterAll(async () => {
  await h.close();
});

describe('role-based access (F-WEB-03)', () => {
  it('keeps members out of every new admin section and support out of curator sections', async () => {
    const m = await member(h);
    const support = await staff('support');
    for (const path of [
      '/v1/admin/cities',
      '/v1/admin/events',
      '/v1/admin/taxonomy',
      '/v1/admin/weights',
      '/v1/admin/notification-templates',
      '/v1/admin/analytics/overview',
      '/v1/admin/team',
    ]) {
      await request(h.http)
        .get(path)
        .set(...bearer(m.token))
        .expect(403);
      await request(h.http).get(path).expect(401);
    }
    await request(h.http)
      .get('/v1/admin/events')
      .set(...bearer(support.token))
      .expect(403);
    await request(h.http)
      .get('/v1/admin/team')
      .set(...bearer(admin))
      .expect(200);
    const plainAdmin = await staff('admin');
    await request(h.http)
      .get('/v1/admin/team')
      .set(...bearer(plainAdmin.token))
      .expect(403);
  });
});

describe('cities and the waitlist (F-GRW-03)', () => {
  it('creates a waitlist city, queues people, refuses it as a home and tells them when it opens', async () => {
    const slug = `mysuru-${suffix()}`;
    const name = `Mysuru ${suffix()}`;
    const body = {
      slug,
      name,
      centre: { lat: 12.2958, lng: 76.6394 },
      bounds: { south: 12.2, west: 76.55, north: 12.4, east: 76.75 },
      timezone: 'Asia/Kolkata',
      launchStatus: 'waitlist',
      languages: ['en', 'te'],
    };
    const created = await request(h.http)
      .post('/v1/admin/cities')
      .set(...bearer(admin))
      .set(...idem())
      .send(body)
      .expect(201);
    const cityId = created.body.id as string;
    await request(h.http)
      .post('/v1/admin/cities')
      .set(...bearer(admin))
      .set(...idem())
      .send(body)
      .expect(409);
    await request(h.http)
      .post('/v1/admin/cities')
      .set(...bearer(admin))
      .set(...idem())
      .send({ ...body, slug: `x-${suffix()}`, timezone: 'Mars/Base' })
      .expect(400);

    const first = await signIn(h);
    const second = await signIn(h);
    const asker = await signIn(h);
    await request(h.http)
      .patch('/v1/me/profile')
      .set(...bearer(first.accessToken))
      .send({ cityId })
      .expect(403)
      .expect((r) => expect(r.body.error.details.reason).toBe('CITY_NOT_LAUNCHED'));
    const joined = await request(h.http)
      .post('/v1/cities/waitlist')
      .set(...bearer(first.accessToken))
      .send({ cityId })
      .expect(200);
    expect(joined.body).toMatchObject({ joined: true, cityId, cityName: name, position: 1 });
    const two = await request(h.http)
      .post('/v1/cities/waitlist')
      .set(...bearer(second.accessToken))
      .send({ cityId })
      .expect(200);
    expect(two.body.position).toBe(2);
    // Joining the same city again keeps your place.
    await request(h.http)
      .post('/v1/cities/waitlist')
      .set(...bearer(first.accessToken))
      .send({ cityId })
      .expect(200)
      .expect((r) => expect(r.body.position).toBe(1));
    const requested = `Nowhere ${suffix()}`;
    await request(h.http)
      .post('/v1/cities/waitlist')
      .set(...bearer(asker.accessToken))
      .send({ cityName: `  ${requested.toUpperCase()} ` })
      .expect(200);
    await request(h.http)
      .post('/v1/cities/waitlist')
      .set(...bearer(asker.accessToken))
      .send({ cityId: hyderabad })
      .expect(409);

    const list = await request(h.http)
      .get('/v1/admin/cities')
      .set(...bearer(admin))
      .expect(200);
    const row = (list.body.items as { id: string; waitlist: number }[]).find(
      (c) => c.id === cityId,
    );
    expect(row?.waitlist).toBe(2);
    expect(
      (list.body.requested as { name: string }[]).some(
        (r) => r.name.toLowerCase() === requested.toLowerCase(),
      ),
    ).toBe(true);

    // Neighbourhoods must sit inside the city.
    await request(h.http)
      .post(`/v1/admin/cities/${cityId}/neighbourhoods`)
      .set(...bearer(admin))
      .set(...idem())
      .send({
        slug: `chamundi-${suffix()}`,
        name: 'Chamundi Hill',
        centroid: { lat: 12, lng: 77 },
        radiusKm: 1,
      })
      .expect(400);
    await request(h.http)
      .post(`/v1/admin/cities/${cityId}/neighbourhoods`)
      .set(...bearer(admin))
      .set(...idem())
      .send({
        slug: `chamundi-${suffix()}`,
        name: 'Chamundi Hill',
        centroid: { lat: 12.31, lng: 76.65 },
        radiusKm: 1.5,
      })
      .expect(201);

    // Opening the city tells everyone waiting (via the worker's `city.launched`).
    const before = await auditCount('cities.update');
    await request(h.http)
      .put(`/v1/admin/cities/${cityId}`)
      .set(...bearer(admin))
      .send({ ...body, launchStatus: 'beta' })
      .expect(200);
    expect(await auditCount('cities.update')).toBe(before + 1);
    const launched = await outboxFor(h, cityId, 'city.launched');
    expect(launched.at(-1)).toMatchObject({ cityId, cityName: name });
    expect(new Set(launched.at(-1)?.userIds as string[])).toEqual(
      new Set([first.user.id, second.user.id]),
    );
    // Now it can be home, which also clears the waitlist entry.
    await request(h.http)
      .patch('/v1/me/profile')
      .set(...bearer(first.accessToken))
      .send({ cityId })
      .expect(200);
    await request(h.http)
      .get('/v1/cities/waitlist')
      .set(...bearer(first.accessToken))
      .expect(200)
      .expect((r) => expect(r.body.joined).toBe(false));
    await request(h.http)
      .delete('/v1/cities/waitlist')
      .set(...bearer(second.accessToken))
      .expect(204);
  });

  it('limits curators to their own cities', async () => {
    const curator = await staff('city_curator', hyderabad);
    const mine = await request(h.http)
      .get('/v1/admin/cities')
      .set(...bearer(curator.token))
      .expect(200);
    expect((mine.body.items as { id: string }[]).map((c) => c.id)).toEqual([hyderabad]);
    expect(mine.body.requested).toEqual([]);
    await request(h.http)
      .post(`/v1/admin/cities/${bengaluru}/neighbourhoods`)
      .set(...bearer(curator.token))
      .set(...idem())
      .send({
        slug: `hsr-${suffix()}`,
        name: 'HSR',
        centroid: { lat: 12.91, lng: 77.64 },
        radiusKm: 1,
      })
      .expect(403);
    await request(h.http)
      .put(`/v1/admin/cities/${hyderabad}`)
      .set(...bearer(curator.token))
      .send({})
      .expect(403);
  });
});

describe('team (F-WEB-03)', () => {
  it('grants and revokes roles, signs the person out, and keeps one super admin', async () => {
    const m = await member(h);
    await request(h.http)
      .post('/v1/admin/team')
      .set(...bearer(admin))
      .set(...idem())
      .send({ userId: m.id, role: 'city_curator' })
      .expect(400);
    await request(h.http)
      .post('/v1/admin/team')
      .set(...bearer(admin))
      .set(...idem())
      .send({ userId: m.id, role: 'city_curator', cityId: bengaluru })
      .expect(201);
    const team = await request(h.http)
      .get('/v1/admin/team')
      .set(...bearer(admin))
      .expect(200);
    const role = (team.body.items as { id: string; userId: string; cityName: string }[]).find(
      (r) => r.userId === m.id,
    );
    expect(role?.cityName).toBe('Bengaluru');
    const signedIn = await signIn(h, m.phone, { inviteCode: null });
    await request(h.http)
      .delete(`/v1/admin/team/${role?.id ?? ''}`)
      .set(...bearer(admin))
      .expect(204);
    await request(h.http)
      .get('/v1/me')
      .set(...bearer(signedIn.accessToken))
      .expect(401);
    const supers = (team.body.items as { id: string; role: string }[]).filter(
      (r) => r.role === 'super_admin',
    );
    if (supers.length === 1)
      await request(h.http)
        .delete(`/v1/admin/team/${supers[0]?.id ?? ''}`)
        .set(...bearer(admin))
        .expect(409);
  });
});

describe('events: curate, feature, edit, cancel (F-WEB-03, F-GRW-03)', () => {
  it('lets a curator publish and feature in their city only, and pins featured plans in the feed', async () => {
    const curator = await staff('city_curator', hyderabad);
    const blrCurator = await staff('city_curator', bengaluru);
    const { rows } = await h.pool.query<{ id: string }>('SELECT id FROM interests LIMIT 1');
    const start = Date.now() + 2 * 86_400_000;
    const body = {
      title: `Heritage walk ${suffix()}`,
      categoryInterestId: rows[0]?.id,
      where: {
        point: { lat: 17.3616, lng: 78.4747 },
        address: 'Charminar',
        placeName: 'Charminar',
      },
      startsAt: new Date(start).toISOString(),
      endsAt: new Date(start + 2 * 3_600_000).toISOString(),
      capacity: 20,
      publish: true,
    };
    // The curator isn't selfie-verified: curated plans are published on TouchGrass's behalf.
    const created = await request(h.http)
      .post('/v1/admin/events')
      .set(...bearer(curator.token))
      .set(...idem())
      .send(body)
      .expect(201);
    const eventId = created.body.id as string;
    await request(h.http)
      .post('/v1/admin/events')
      .set(...bearer(blrCurator.token))
      .set(...idem())
      .send(body)
      .expect(403);

    const list = await request(h.http)
      .get('/v1/admin/events')
      .query({ type: 'curated', q: body.title.slice(0, 15) })
      .set(...bearer(curator.token))
      .expect(200);
    expect(list.body.items[0]).toMatchObject({ id: eventId, type: 'curated', cityId: hyderabad });
    const blrList = await request(h.http)
      .get('/v1/admin/events')
      .query({ cityId: hyderabad })
      .set(...bearer(blrCurator.token))
      .expect(200);
    expect(blrList.body.items).toEqual([]);

    await request(h.http)
      .put(`/v1/admin/events/${eventId}/feature`)
      .set(...bearer(blrCurator.token))
      .send({ until: new Date(start).toISOString(), rank: 1 })
      .expect(403);
    await request(h.http)
      .put(`/v1/admin/events/${eventId}/feature`)
      .set(...bearer(curator.token))
      .send({ until: new Date(start + 5 * 3_600_000).toISOString(), rank: 1 })
      .expect(400);
    const featured = await request(h.http)
      .put(`/v1/admin/events/${eventId}/feature`)
      .set(...bearer(curator.token))
      .send({ until: new Date(start).toISOString(), rank: 1 })
      .expect(200);
    expect(featured.body.featured).toMatchObject({ rank: 1 });

    // A member in Hyderabad sees it first, labelled.
    const viewer = await member(h);
    const feed = await request(h.http)
      .get('/v1/discover/feed')
      .query({ lat: 17.3616, lng: 78.4747, radiusKm: 2 })
      .set(...bearer(viewer.token))
      .expect(200);
    const items = feed.body.items as FeedItem[];
    const at = items.findIndex((i) => i.id === eventId);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(items[at]?.reasons[0]).toBe('featured');
    // Featured plans come before everything that isn't.
    expect(items.slice(0, at).every((i) => i.reasons.includes('featured'))).toBe(true);

    // Staff edit and cancel, both audited.
    const edits = await auditCount('events.update');
    const edited = await request(h.http)
      .patch(`/v1/admin/events/${eventId}`)
      .set(...bearer(curator.token))
      .send({ title: 'Heritage walk at dawn' })
      .expect(200);
    expect(edited.body.title).toBe('Heritage walk at dawn');
    expect(await auditCount('events.update')).toBe(edits + 1);
    const cancelled = await request(h.http)
      .post(`/v1/admin/events/${eventId}/cancel`)
      .set(...bearer(curator.token))
      .set(...idem())
      .send({ reason: 'Rain all morning' })
      .expect(200);
    // Cancelling also unpins it.
    expect(cancelled.body).toMatchObject({
      status: 'cancelled',
      cancelledReason: 'Rain all morning',
      featured: null,
    });
    await request(h.http)
      .delete(`/v1/admin/events/${eventId}/feature`)
      .set(...bearer(curator.token))
      .expect(204);
  });

  it('lets admins act on anyone’s plan and refuses to feature private ones', async () => {
    const host = await verifiedMember(h);
    const plan = await plot(h, host, { visibility: 'invite_only', publish: true });
    await request(h.http)
      .get(`/v1/admin/events/${plan.id}`)
      .set(...bearer(admin))
      .expect(200)
      .expect((r) => expect(r.body.visibility).toBe('invite_only'));
    await request(h.http)
      .put(`/v1/admin/events/${plan.id}/feature`)
      .set(...bearer(admin))
      .send({ until: plan.startsAt })
      .expect(409);
    // The mobile plot endpoint still needs a curator role for curated plans.
    await request(h.http)
      .post('/v1/events')
      .set(...bearer(host.token))
      .set(...idem())
      .send({ ...(await planBody(h)), type: 'curated' })
      .expect(403);
  });
});

describe('taxonomy, weights and templates (F-WEB-03)', () => {
  it('adds, renames and retires interests and vibe tags', async () => {
    const slug = `pottery-${suffix()}`;
    const name = { en: 'Pottery', te: 'కుండలు', hi: 'मिट्टी के बर्तन' };
    const created = await request(h.http)
      .post('/v1/admin/taxonomy/interests')
      .set(...bearer(admin))
      .set(...idem())
      .send({ slug, name, emoji: '🏺', category: 'creative' })
      .expect(201);
    await request(h.http)
      .post('/v1/admin/taxonomy/interests')
      .set(...bearer(admin))
      .set(...idem())
      .send({ slug, name, emoji: '🏺', category: 'creative' })
      .expect(409);
    const visible = await request(h.http)
      .get('/v1/interests')
      .set(...fromIp())
      .expect(200);
    expect((visible.body.items as { slug: string }[]).some((i) => i.slug === slug)).toBe(true);
    await request(h.http)
      .put(`/v1/admin/taxonomy/interests/${created.body.id as string}`)
      .set(...bearer(admin))
      .send({ slug, name, emoji: '🏺', category: 'creative', active: false })
      .expect(200);
    const hidden = await request(h.http)
      .get('/v1/interests')
      .set(...fromIp())
      .expect(200);
    expect((hidden.body.items as { slug: string }[]).some((i) => i.slug === slug)).toBe(false);
    await request(h.http)
      .post('/v1/admin/taxonomy/vibe-tags')
      .set(...bearer(admin))
      .set(...idem())
      .send({
        slug: `cosy-${suffix()}`,
        name: { en: 'Cosy', te: 'హాయిగా', hi: 'आरामदायक' },
        emoji: '🛋️',
      })
      .expect(201);
    const all = await request(h.http)
      .get('/v1/admin/taxonomy')
      .set(...bearer(admin))
      .expect(200);
    expect(all.body.interests.length).toBeGreaterThan(5);
    expect((all.body.interests as { usage: number }[]).some((i) => i.usage > 0)).toBe(true);
  });

  it('tunes and resets recommendation weights', async () => {
    const view = await request(h.http)
      .get('/v1/admin/weights')
      .set(...bearer(admin))
      .expect(200);
    const weights = { ...view.body.defaults, squadGoing: 6 };
    await request(h.http)
      .put('/v1/admin/weights')
      .set(...bearer(admin))
      .send({ ...weights, popular: 12 })
      .expect(400);
    const saved = await request(h.http)
      .put('/v1/admin/weights')
      .set(...bearer(admin))
      .send(weights)
      .expect(200);
    expect(saved.body.weights.squadGoing).toBe(6);
    expect(saved.body.updatedAt).not.toBeNull();
    const reset = await request(h.http)
      .delete('/v1/admin/weights')
      .set(...bearer(admin))
      .expect(200);
    expect(reset.body.weights).toEqual(reset.body.defaults);
  });

  it('rewords a notification per language, with only its own placeholders', async () => {
    const list = await request(h.http)
      .get('/v1/admin/notification-templates')
      .set(...bearer(admin))
      .expect(200);
    const friend = (list.body.items as { kind: string; placeholders: string[] }[]).find(
      (t) => t.kind === 'friend_requested',
    );
    expect(friend?.placeholders).toContain('name');
    await request(h.http)
      .put('/v1/admin/notification-templates/friend_requested/en')
      .set(...bearer(admin))
      .send({ title: '{{name}} sent {{amount}}', body: 'Say hi' })
      .expect(400);
    await request(h.http)
      .put('/v1/admin/notification-templates/not_a_kind/en')
      .set(...bearer(admin))
      .send({ title: 'x', body: 'y' })
      .expect(400);
    await request(h.http)
      .put('/v1/admin/notification-templates/friend_requested/en')
      .set(...bearer(admin))
      .send({ title: '{{name}} wants in 🌱', body: 'Your squad is growing.' })
      .expect(200);
    const a = await member(h);
    const b = await member(h);
    await request(h.http)
      .post('/v1/social/requests')
      .set(...bearer(a.token))
      .set(...idem())
      .send({ userId: b.id })
      .expect(200);
    await h.pool.query(
      `INSERT INTO notifications (user_id, kind, category, params, path)
       VALUES ($1, 'friend_requested', 'squad', '{"name":"Asha"}', 'squad')`,
      [b.id],
    );
    const inbox = await request(h.http)
      .get('/v1/notifications')
      .set(...bearer(b.token))
      .expect(200);
    expect(
      (inbox.body.items as { title: string }[]).some((i) => i.title === 'Asha wants in 🌱'),
    ).toBe(true);
    await request(h.http)
      .delete('/v1/admin/notification-templates/friend_requested/en')
      .set(...bearer(admin))
      .expect(204);
    const restored = await request(h.http)
      .get('/v1/notifications')
      .set(...bearer(b.token))
      .expect(200);
    expect((restored.body.items as { title: string }[]).every((i) => !i.title.includes('🌱'))).toBe(
      true,
    );
  });
});

describe('analytics overview (F-WEB-03)', () => {
  it('counts each domain event once, per city and day, within the caller’s cities', async () => {
    const counters = h.app.get(AnalyticsCountersService);
    const m = await member(h);
    const job = {
      eventId: crypto.randomUUID(),
      aggregateType: 'user',
      aggregateId: m.id,
      type: 'user.onboarded',
      payload: { userId: m.id },
      occurredAt: new Date().toISOString(),
    };
    const before = await request(h.http)
      .get('/v1/admin/analytics/overview')
      .query({ cityId: hyderabad, days: 7 })
      .set(...bearer(admin))
      .expect(200);
    expect(await counters.record(job)).toBe(true);
    expect(await counters.record(job)).toBe(false);
    const after = await request(h.http)
      .get('/v1/admin/analytics/overview')
      .query({ cityId: hyderabad, days: 7 })
      .set(...bearer(admin))
      .expect(200);
    expect(after.body.totals.onboarded).toBe((before.body.totals.onboarded as number) + 1);
    expect(after.body.daily).toHaveLength(7);
    expect(after.body.activeUsers).toBeGreaterThanOrEqual(1);

    const curator = await staff('city_curator', bengaluru);
    await request(h.http)
      .get('/v1/admin/analytics/overview')
      .query({ cityId: hyderabad })
      .set(...bearer(curator.token))
      .expect(403);
    // Without a city, a curator's overview is their cities' only, never the whole country.
    const own = await request(h.http)
      .get('/v1/admin/analytics/overview')
      .query({ days: 30 })
      .set(...bearer(curator.token))
      .expect(200);
    const blr = await request(h.http)
      .get('/v1/admin/analytics/overview')
      .query({ cityId: bengaluru, days: 30 })
      .set(...bearer(admin))
      .expect(200);
    expect(own.body.totals).toEqual(blr.body.totals);
    const everywhere = await request(h.http)
      .get('/v1/admin/analytics/overview')
      .query({ days: 30 })
      .set(...bearer(admin))
      .expect(200);
    expect(everywhere.body.totals.onboarded).toBeGreaterThan(own.body.totals.onboarded);
    await request(h.http)
      .get('/v1/admin/analytics/overview')
      .query({ days: 14 })
      .set(...bearer(admin))
      .expect(400);
  });
});
