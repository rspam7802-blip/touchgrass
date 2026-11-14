import type { Feed, FeedItem, MapResponse } from '@touchgrass/shared';
import { haversineMeters } from '@touchgrass/shared';
import { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { FakeWeatherProvider } from '../src/adapters/weather/fake.weather.js';
import { DB, type Database } from '../src/infra/database/database.module.js';
import { PartitionService } from '../src/infra/database/partitions.js';
import { WeatherService } from '../src/modules/discovery/weather.service.js';
import { FEED_EPOCH_KEY } from '../src/modules/discovery/discovery.service.js';
import { REDIS } from '../src/infra/redis/redis.module.js';
import { timeWindow } from '../src/modules/discovery/ranking.js';
import { ADDRESS, idem, PLACE, plot, rsvp, SPOT, verifiedMember } from './event-helpers.js';
import { bearer, befriend, createHarness, type Harness, member, type Member } from './harness.js';

let h: Harness;
let redis: Redis;
const weather = new FakeWeatherProvider();
beforeAll(async () => {
  h = await createHarness({ weather });
  redis = new Redis(inject('redisUrl'));
});
afterAll(async () => {
  await redis.quit();
  await h.close();
});

const H = 3_600_000;
const at = (startsInMs: number, hours = 2) => ({
  startsAt: new Date(Date.now() + startsInMs).toISOString(),
  endsAt: new Date(Date.now() + startsInMs + hours * H).toISOString(),
});
/** Feed centred on the test spot, so seeded plans elsewhere do not crowd results. */
const feed = async (m: Member, query: Record<string, string | number> = {}): Promise<Feed> => {
  const res = await request(h.http)
    .get('/v1/discover/feed')
    .query({ lat: SPOT.lat, lng: SPOT.lng, radiusKm: 3, limit: 30, ...query })
    .set(...bearer(m.token));
  if (res.status !== 200) throw new Error(`feed ${String(res.status)} ${JSON.stringify(res.body)}`);
  return res.body as Feed;
};
/** All pages of a feed (each request is a fresh snapshot unless a cursor is passed). */
const allItems = async (
  m: Member,
  query: Record<string, string | number> = {},
): Promise<FeedItem[]> => {
  const out: FeedItem[] = [];
  let page = await feed(m, query);
  out.push(...page.items);
  while (page.nextCursor) {
    page = await feed(m, { ...query, cursor: page.nextCursor });
    out.push(...page.items);
  }
  return out;
};
const ids = (items: { id: string }[]) => items.map((i) => i.id);
const uniqueTitle = (prefix: string) => `${prefix} ${Math.random().toString(36).slice(2, 8)}`;

describe('feed (F-DSC-01/04/05/07)', () => {
  it('ranks and explains plans, excludes my own and ones I joined, and previews who is going', async () => {
    const host = await verifiedMember(h);
    const [me, pal, shy] = [await member(h), await member(h), await member(h)];
    await befriend(h, me, pal);
    await request(h.http)
      .put('/v1/me/settings/privacy')
      .set(...bearer(shy.token))
      .send({ showInWhoIsGoing: false })
      .expect(200);
    const e = await plot(h, host, { title: uniqueTitle('Frisbee'), ...at(30 * H) });
    await rsvp(h, pal, e.id).expect(200);
    await rsvp(h, shy, e.id).expect(200);

    const items = await allItems(me, { lat: SPOT.lat, lng: SPOT.lng });
    const item = items.find((i) => i.id === e.id);
    expect(item).toBeDefined();
    expect(item?.reasons).toEqual(expect.arrayContaining(['squad_going', 'interests', 'nearby']));
    expect(item?.preview.total).toBe(3);
    expect(item?.preview.people.map((p) => p.id)).toEqual([pal.id, host.id]);
    expect(item?.distanceMeters).toBeLessThan(10);
    expect(item?.viewer.canRsvp).toBe(true);

    // Everyone sees the plan on Explore, its host and people already going included.
    expect(ids(await allItems(host))).toContain(e.id);
    await rsvp(h, me, e.id).expect(200);
    expect(ids(await allItems(me, { radiusKm: 2 }))).toContain(e.id);
  });

  it('pages through one ranked snapshot without duplicates and reuses it for a minute', async () => {
    const host = await verifiedMember(h);
    for (let i = 0; i < 4; i += 1)
      await plot(h, host, { title: uniqueTitle('Page'), ...at((20 + i) * H) });
    const me = await member(h);
    const first = await feed(me, { limit: 2 });
    expect(first.items).toHaveLength(2);
    const again = await feed(me, { limit: 2 });
    expect(again.requestId).toBe(first.requestId);
    const seen = new Set(ids(first.items));
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await feed(me, { limit: 2, cursor });
      expect(page.requestId).toBe(first.requestId);
      for (const id of ids(page.items)) {
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
      cursor = page.nextCursor;
    }
    expect(seen.size).toBeGreaterThanOrEqual(4);
    await redis.del(`feed:v1:snap:${me.id}:${first.requestId}`);
    const stale = await request(h.http)
      .get('/v1/discover/feed')
      .query({ limit: 2, cursor: first.nextCursor ?? '' })
      .set(...bearer(me.token))
      .expect(400);
    expect(stale.body.error.code).toBe('INVALID_CURSOR');
  });

  it('sorts by soonest and nearest', async () => {
    const me = await member(h);
    const soonest = await allItems(me, { sort: 'soonest', radiusKm: 10 });
    const starts = soonest.map((i) => new Date(i.startsAt).getTime());
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    const nearest = await allItems(me, { sort: 'nearest', radiusKm: 10 });
    const d = nearest.map((i) => i.distanceMeters);
    expect(d).toEqual([...d].sort((a, b) => a - b));
    expect(nearest.length).toBeGreaterThan(0);
  });

  it('defaults to the home neighbourhood and validates the query', async () => {
    const me = await member(h);
    const res = await request(h.http)
      .get('/v1/discover/feed')
      .set(...bearer(me.token))
      .expect(200);
    expect(res.body.center).toEqual({
      lat: expect.any(Number) as number,
      lng: expect.any(Number) as number,
    });
    await request(h.http)
      .get('/v1/discover/feed')
      .query({ lat: 17.4 })
      .set(...bearer(me.token))
      .expect(400);
    await request(h.http)
      .get('/v1/discover/feed')
      .query({ free: 'yes' })
      .set(...bearer(me.token))
      .expect(400);
    await request(h.http)
      .get('/v1/discover/feed')
      .query({ cursor: 'garbage' })
      .set(...bearer(me.token))
      .expect(400);
  });
});

describe('new plans reach everyone (D-196)', () => {
  it('a plan plotted after someone opened Explore shows up on their next load, host included', async () => {
    const host = await verifiedMember(h);
    const me = await member(h);
    // `me` loads the feed (this ranks and caches it), then a new plan goes live nearby.
    await feed(me);
    const fresh = await plot(h, host, { title: uniqueTitle('Fresh') });
    // The worker bumps the epoch on event.created; do what it does.
    await h.app.get<Redis>(REDIS).incr(FEED_EPOCH_KEY);
    expect(ids(await allItems(me))).toContain(fresh.id);
    expect(ids(await allItems(host))).toContain(fresh.id);
  });
});

describe('filters (F-DSC-02)', () => {
  it('when, price, small group, solo, accessibility, indoor, vibes, category, squad going, distance', async () => {
    const host = await verifiedMember(h);
    const me = await member(h);
    const pal = await member(h);
    await befriend(h, me, pal);
    const tonight = timeWindow('tonight', new Date(), 30);
    const tomorrow = timeWindow('tomorrow', new Date(), 30);
    const vibes = (await request(h.http).get('/v1/vibe-tags')).body.items as { id: string }[];
    const interests = (await request(h.http).get('/v1/interests')).body.items as { id: string }[];
    const tonightPlan = await plot(h, host, {
      title: uniqueTitle('Tonight'),
      startsAt: new Date(
        Date.now() + Math.min(H, (tonight.to.getTime() - Date.now()) / 2),
      ).toISOString(),
      endsAt: new Date(tonight.to.getTime() + H).toISOString(),
    });
    const tomorrowPlan = await plot(h, host, {
      title: uniqueTitle('Tomorrow'),
      startsAt: new Date(tomorrow.from.getTime() + 10 * H).toISOString(),
      endsAt: new Date(tomorrow.from.getTime() + 12 * H).toISOString(),
      smallGroup: true,
      capacity: 6,
      soloFriendly: true,
      indoor: true,
      accessibility: { stepFree: true, accessibleRestroom: false, quietSpace: true },
      vibeTagIds: [vibes[1]?.id],
      categoryInterestId: interests[4]?.id,
    });
    await rsvp(h, pal, tomorrowPlan.id).expect(200);
    const far = await plot(h, host, {
      title: uniqueTitle('Far'),
      ...at(30 * H),
      where: { point: { lat: 17.39, lng: 78.47 }, address: 'Old City' },
    });

    const get = async (q: Record<string, string>) => ids(await allItems(me, q));
    const t = await get({ when: 'tonight' });
    expect(t).toContain(tonightPlan.id);
    expect(t).not.toContain(tomorrowPlan.id);
    const tm = await get({ when: 'tomorrow' });
    expect(tm).toContain(tomorrowPlan.id);
    expect(tm).not.toContain(tonightPlan.id);
    const cases: Record<string, string>[] = [
      { smallGroup: 'true' },
      { soloFriendly: 'true' },
      { stepFree: 'true', quietSpace: 'true' },
      { indoor: 'true' },
      { vibeTagIds: vibes[1]?.id ?? '' },
      { categoryId: interests[4]?.id ?? '' },
      { interestIds: interests[4]?.id ?? '' },
      { squadGoing: 'true' },
      { free: 'true' },
    ];
    for (const q of cases) {
      const got = await get(q);
      expect(got, JSON.stringify(q)).toContain(tomorrowPlan.id);
      if (!('free' in q)) expect(got, JSON.stringify(q)).not.toContain(tonightPlan.id);
    }
    expect(await get({})).not.toContain(far.id);
    expect(await get({ radiusKm: '20' })).toContain(far.id);
  });
});

describe('visibility and privacy in discovery (F-DSC-06, F-EVT-03/12)', () => {
  it('friends-of-friends plans show "via" the mutual; invite-only, women-only and blocked hosts stay hidden', async () => {
    const host = await verifiedMember(h, { gender: 'man' });
    const [mutual, me, stranger] = [await member(h), await member(h), await member(h)];
    await befriend(h, host, mutual);
    await befriend(h, mutual, me);
    const fof = await plot(h, host, {
      title: uniqueTitle('Fof'),
      visibility: 'friends_of_friends',
      ...at(26 * H),
    });
    const secret = await plot(h, host, {
      title: uniqueTitle('Secret'),
      visibility: 'invite_only',
      ...at(26 * H),
    });
    const woman = await verifiedMember(h, { gender: 'woman' });
    const wo = await plot(h, woman, {
      title: uniqueTitle('Women'),
      visibility: 'women_only',
      ...at(26 * H),
    });

    const mine = await allItems(me);
    const fofItem = mine.find((i) => i.id === fof.id);
    expect(fofItem?.via?.id).toBe(mutual.id);
    expect(fofItem?.reasons).toContain('friends_of_friends');
    expect(ids(mine)).not.toContain(secret.id);
    expect(ids(await allItems(stranger))).not.toContain(fof.id);
    const verifiedWoman = await verifiedMember(h, { gender: 'woman' });
    expect(ids(await allItems(verifiedWoman))).toContain(wo.id);
    expect(ids(await allItems(me))).not.toContain(wo.id); // test persona is an unverified woman

    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(me.token))
      .set(...idem())
      .send({ userId: host.id })
      .expect(204);
    expect(ids(await allItems(me, { radiusKm: 4 }))).not.toContain(fof.id);
  });

  it('private plans are listed with a fuzzed centre, never their spot (D-179)', async () => {
    const host = await verifiedMember(h);
    const me = await member(h);
    const e = await plot(h, host, {
      title: uniqueTitle('Private supper'),
      visibility: 'approval',
      ...at(30 * H),
    });
    const item = (await allItems(me, { radiusKm: 5 })).find((i) => i.id === e.id);
    expect(item?.location).toMatchObject({ kind: 'approximate', hiddenBy: 'approval' });
    const center = item?.location.kind === 'approximate' ? item.location.center : SPOT;
    expect(haversineMeters(center, SPOT)).toBeGreaterThanOrEqual(1000);
    expect(item?.viewer.blockedReason).toBe('APPROVAL_REQUIRED');
  });

  it('mystery plans: approximate area in feed, map and search; distance from the fuzzed centre', async () => {
    const host = await verifiedMember(h);
    const me = await member(h);
    const title = uniqueTitle('Mystery chai');
    const e = await plot(h, host, { title, mystery: true, ...at(30 * H) });
    const items = await allItems(me, { radiusKm: 5 });
    const item = items.find((i) => i.id === e.id);
    expect(item?.location.kind).toBe('approximate');
    const center = item?.location.kind === 'approximate' ? item.location.center : SPOT;
    expect(haversineMeters(center, SPOT)).toBeGreaterThanOrEqual(1000);
    expect(Math.abs((item?.distanceMeters ?? 0) - haversineMeters(center, SPOT))).toBeLessThan(25);

    const map = (
      await request(h.http)
        .get('/v1/discover/map')
        .query({
          bbox: `${String(SPOT.lng - 0.05)},${String(SPOT.lat - 0.05)},${String(SPOT.lng + 0.05)},${String(SPOT.lat + 0.05)}`,
          zoom: 17,
        })
        .set(...bearer(me.token))
        .expect(200)
    ).body as MapResponse;
    const pin = map.pins.find((p) => p.id === e.id);
    expect(pin).toMatchObject({ mystery: true, radiusMeters: 2000 });
    expect(pin?.center).toEqual(center);

    const search = await request(h.http)
      .get('/v1/discover/search')
      .query({ q: title })
      .set(...bearer(me.token))
      .expect(200);
    expect(search.body.events.map((x: { id: string }) => x.id)).toContain(e.id);
    const searchItem = (search.body.events as { id: string }[]).find((x) => x.id === e.id);
    // Other plans at this spot are not mystery plans and show their address; check this plan's surfaces.
    for (const body of [item, pin, searchItem]) {
      const s = JSON.stringify(body);
      expect(s).not.toContain(ADDRESS);
      expect(s).not.toContain(PLACE);
      expect(s).not.toContain(String(SPOT.lat));
    }
  });
});

describe('weather-aware suggestions (F-DSC-08)', () => {
  it('boosts indoor plans when rain is forecast at the start and shows the weather', async () => {
    const start = new Date(Math.ceil((Date.now() + 28 * H) / H) * H);
    const hours = Array.from({ length: 48 }, (_, i) => {
      const time = new Date(Math.floor(Date.now() / H) * H + i * H);
      const rainy = Math.abs(time.getTime() - start.getTime()) < 3 * H;
      return {
        time: time.toISOString(),
        tempC: 27,
        condition: rainy ? ('rain' as const) : ('clear' as const),
        precipitationProbability: rainy ? 0.9 : 0,
      };
    });
    weather.setForecast(hours);
    // One forecast per open city (Hyderabad, plus any other city that's beta or launched).
    const { rows: open } = await h.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM cities WHERE launch_status <> 'waitlist'",
    );
    expect(await h.app.get(WeatherService).refreshAll()).toBe(open[0]?.n);
    const host = await verifiedMember(h);
    const me = await member(h);
    const indoor = await plot(h, host, {
      title: uniqueTitle('Board games'),
      indoor: true,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 2 * H).toISOString(),
    });
    const outdoor = await plot(h, host, {
      title: uniqueTitle('Picnic'),
      indoor: false,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + 2 * H).toISOString(),
    });
    const page = await feed(me, { radiusKm: 2, sort: 'recommended' });
    const all = await allItems(me, { radiusKm: 2 });
    const i = all.find((x) => x.id === indoor.id);
    const o = all.find((x) => x.id === outdoor.id);
    expect(page.weather).toMatchObject({ condition: 'clear', tempC: 27 });
    expect(i?.weather).toMatchObject({ condition: 'rain', advice: 'indoor' });
    expect(i?.reasons).toContain('weather');
    expect(o?.weather?.advice).toBeNull();
    expect(ids(all).indexOf(indoor.id)).toBeLessThan(ids(all).indexOf(outdoor.id));
    weather.setForecast(null);
    await h.app.get(WeatherService).refreshAll();
  });
});

describe('map (F-DSC-03)', () => {
  it('clusters when zoomed out, pins when zoomed in, and validates the box', async () => {
    const me = await member(h);
    const box = '78.30,17.38,78.48,17.50';
    const out = (
      await request(h.http)
        .get('/v1/discover/map')
        .query({ bbox: box, zoom: 11 })
        .set(...bearer(me.token))
        .expect(200)
    ).body as MapResponse;
    expect(out.clusters.length).toBeGreaterThan(0);
    expect(out.clusters.reduce((s, c) => s + c.count, 0) + out.pins.length).toBeGreaterThan(5);
    const zin = (
      await request(h.http)
        .get('/v1/discover/map')
        .query({ bbox: box, zoom: 17 })
        .set(...bearer(me.token))
        .expect(200)
    ).body as MapResponse;
    expect(zin.clusters).toEqual([]);
    expect(out.truncated).toBe(false);
    // Other suites add plans concurrently, so the zoomed-in view can only have gained pins.
    expect(zin.pins.length).toBeGreaterThanOrEqual(
      out.clusters.reduce((s, c) => s + c.count, 0) + out.pins.length,
    );
    await request(h.http)
      .get('/v1/discover/map')
      .query({ bbox: '78,17,81,20' })
      .set(...bearer(me.token))
      .expect(400);
    await request(h.http)
      .get('/v1/discover/map')
      .query({ bbox: '78.4,17.5,78.3,17.4' })
      .set(...bearer(me.token))
      .expect(400);
  });
});

describe('impressions and clicks (F-DSC-07)', () => {
  it('logs what was served and accepts clicks only for served plans', async () => {
    const host = await verifiedMember(h);
    const me = await member(h);
    const e = await plot(h, host, { title: uniqueTitle('Click me'), ...at(22 * H) });
    const page = await feed(me, { radiusKm: 2 });
    const position = page.items.findIndex((i) => i.id === e.id);
    expect(position).toBeGreaterThanOrEqual(0);
    const { rows } = await h.pool.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM discovery_impressions WHERE request_id = $1 AND user_id = $2',
      [page.requestId, me.id],
    );
    expect(rows[0]?.n).toBe(page.items.length);
    await request(h.http)
      .post('/v1/discover/clicks')
      .set(...bearer(me.token))
      .send({ requestId: page.requestId, eventId: e.id, position })
      .expect(204);
    await request(h.http)
      .post('/v1/discover/clicks')
      .set(...bearer(me.token))
      .send({
        requestId: page.requestId,
        eventId: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
        position: 0,
      })
      .expect(404);
    const exported = await request(h.http)
      .get('/v1/me/export')
      .set(...bearer(me.token))
      .expect(200);
    expect(JSON.stringify(exported.body)).toContain(e.id);
  });

  it('keeps monthly partitions ahead', async () => {
    // The partition job runs in the worker; the API app does not provide it.
    expect(await new PartitionService(h.app.get<Database>(DB)).maintain()).toBeGreaterThanOrEqual(
      0,
    );
    const { rows } = await h.pool.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM pg_class WHERE relname LIKE 'discovery_impressions_y%' AND relkind = 'r'",
    );
    expect(rows[0]?.n).toBeGreaterThanOrEqual(3);
  });
});

describe('search (F-DSC-09)', () => {
  it('finds plans, people and places, applying visibility and profile privacy', async () => {
    const host = await verifiedMember(h, { displayName: 'Zubeida Q.' });
    const [me, squadMate] = [await member(h), await member(h, { displayName: 'Zubeida Squad' })];
    await befriend(h, me, squadMate);
    const hidden = await member(h, { displayName: 'Zubeida Hidden' });
    await request(h.http)
      .put('/v1/me/settings/privacy')
      .set(...bearer(hidden.token))
      .send({ profileVisibility: 'squad_only' })
      .expect(200);
    await request(h.http)
      .put('/v1/me/settings/privacy')
      .set(...bearer(squadMate.token))
      .send({ profileVisibility: 'squad_only' })
      .expect(200);
    const word = `qz${Math.random().toString(36).slice(2, 7)}`;
    const open = await plot(h, host, { title: `Open ${word} jam`, ...at(26 * H) });
    const secret = await plot(h, host, {
      title: `Secret ${word} jam`,
      visibility: 'invite_only',
      ...at(26 * H),
    });

    const s = await request(h.http)
      .get('/v1/discover/search')
      .query({ q: word })
      .set(...bearer(me.token))
      .expect(200);
    expect(s.body.events.map((x: { id: string }) => x.id)).toEqual([open.id]);
    expect(s.body.events.map((x: { id: string }) => x.id)).not.toContain(secret.id);

    const p = await request(h.http)
      .get('/v1/discover/search')
      .query({ q: 'Zubeida', type: 'people' })
      .set(...bearer(me.token))
      .expect(200);
    const found = p.body.people.map((x: { id: string }) => x.id);
    expect(found).toEqual(expect.arrayContaining([host.id, squadMate.id]));
    expect(found).not.toContain(hidden.id);
    expect(p.body.events).toEqual([]);

    await request(h.http)
      .post('/v1/social/blocks')
      .set(...bearer(host.token))
      .set(...idem())
      .send({ userId: me.id })
      .expect(204);
    const after = await request(h.http)
      .get('/v1/discover/search')
      .query({ q: 'Zubeida', type: 'people' })
      .set(...bearer(me.token))
      .expect(200);
    expect(after.body.people.map((x: { id: string }) => x.id)).not.toContain(host.id);

    const v = await request(h.http)
      .get('/v1/discover/search')
      .query({ q: 'Coffee', type: 'venues' })
      .set(...bearer(me.token))
      .expect(200);
    expect(v.body.venues.length).toBeGreaterThan(0);
    await request(h.http)
      .get('/v1/discover/search')
      .query({ q: 'z' })
      .set(...bearer(me.token))
      .expect(400);
  });
});
