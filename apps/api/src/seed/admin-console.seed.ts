import { ANALYTICS_METRICS, type AnalyticsMetric } from '@touchgrass/shared';
import { sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Tx } from '../infra/database/database.module.js';
import { dayIn } from '../modules/analytics/analytics-counters.service.js';
import { analyticsActive, analyticsDaily, cityWaitlist } from '../infra/database/schema/index.js';

export interface AdminConsoleSeedSummary {
  cities: number;
  waitlisted: number;
  curators: number;
  featured: number;
  analyticsDays: number;
}

/** A second open city and one still on the waitlist (F-GRW-03). */
export const BENGALURU = {
  slug: 'bengaluru',
  name: 'Bengaluru',
  centre: { lat: 12.9716, lng: 77.5946 },
  bounds: { south: 12.8, west: 77.4, north: 13.15, east: 77.8 },
  timezone: 'Asia/Kolkata',
  launchStatus: 'beta' as const,
  languages: ['en', 'hi'],
  neighbourhoods: [
    { slug: 'indiranagar', name: 'Indiranagar', centroid: { lat: 12.9784, lng: 77.6408 } },
    { slug: 'koramangala', name: 'Koramangala', centroid: { lat: 12.9352, lng: 77.6245 } },
  ],
};
export const VISAKHAPATNAM = {
  slug: 'visakhapatnam',
  name: 'Visakhapatnam',
  centre: { lat: 17.6868, lng: 83.2185 },
  bounds: { south: 17.6, west: 83.1, north: 17.85, east: 83.4 },
  timezone: 'Asia/Kolkata',
  launchStatus: 'waitlist' as const,
  languages: ['en', 'te'],
  neighbourhoods: [],
};

/** Seeded member #30 curates Hyderabad; member #31 curates Bengaluru (sign in with OTP 000000). */
export const SEED_CURATOR_INDEX = 29;
export const SEED_BENGALURU_CURATOR_INDEX = 30;
/** Members #195–#199 are waiting for Visakhapatnam; #200 asked for a city that isn't on TouchGrass yet. */
const WAITLIST_INDEXES = [194, 195, 196, 197, 198];
const REQUESTED_INDEX = 199;

/** Stable small pseudo-random numbers so re-seeding draws the same history. */
function wobble(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

async function upsertCity(tx: Tx, c: typeof BENGALURU | typeof VISAKHAPATNAM): Promise<string> {
  const res = await tx.execute<{ id: string }>(sql`
    INSERT INTO cities (id, slug, name, centre, bounds, timezone, launch_status, languages)
    VALUES (${uuidv7()}, ${c.slug}, ${c.name},
      ST_SetSRID(ST_MakePoint(${c.centre.lng}, ${c.centre.lat}), 4326)::geography,
      ST_MakeEnvelope(${c.bounds.west}, ${c.bounds.south}, ${c.bounds.east}, ${c.bounds.north}, 4326)::geography,
      ${c.timezone}, ${c.launchStatus},
      ARRAY[${sql.join(
        c.languages.map((l) => sql`${l}`),
        sql`, `,
      )}]::text[])
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
    RETURNING id`);
  const id = res.rows[0]?.id;
  if (!id) throw new Error(`Failed to upsert ${c.name}`);
  for (const n of c.neighbourhoods) {
    await tx.execute(sql`
      INSERT INTO neighbourhoods (id, city_id, slug, name, centroid, boundary)
      VALUES (${uuidv7()}, ${id}, ${n.slug}, ${n.name},
        ST_SetSRID(ST_MakePoint(${n.centroid.lng}, ${n.centroid.lat}), 4326)::geography,
        ST_Buffer(ST_SetSRID(ST_MakePoint(${n.centroid.lng}, ${n.centroid.lat}), 4326)::geography, 1500))
      ON CONFLICT (city_id, slug) DO NOTHING`);
  }
  return id;
}

/**
 * Phase 11 seed (idempotent): Bengaluru (open, beta) and Visakhapatnam (waitlist) as data, curators for
 * Hyderabad and Bengaluru, people waiting for Visakhapatnam, one featured Hyderabad plan, and 30 days of
 * analytics overview counters so the admin dashboard has something to show.
 */
export async function seedAdminConsole(
  tx: Tx,
  ctx: { cityId: string; memberIds: string[]; adminId: string },
  now: Date = new Date(),
): Promise<AdminConsoleSeedSummary> {
  const bengaluru = await upsertCity(tx, BENGALURU);
  const vizag = await upsertCity(tx, VISAKHAPATNAM);

  const curator = ctx.memberIds[SEED_CURATOR_INDEX];
  const blrCurator = ctx.memberIds[SEED_BENGALURU_CURATOR_INDEX];
  if (!curator || !blrCurator) throw new Error('Seed curators missing');
  for (const [userId, cityId] of [
    [curator, ctx.cityId],
    [blrCurator, bengaluru],
  ] as const) {
    await tx.execute(sql`
      INSERT INTO user_roles (id, user_id, role, city_id) VALUES (${uuidv7()}, ${userId}, 'city_curator', ${cityId})
      ON CONFLICT DO NOTHING`);
  }

  for (const [i, idx] of WAITLIST_INDEXES.entries()) {
    const userId = ctx.memberIds[idx];
    if (!userId) continue;
    await tx
      .insert(cityWaitlist)
      .values({ userId, cityId: vizag, createdAt: new Date(now.getTime() - (10 - i) * 86_400_000) })
      .onConflictDoNothing();
  }
  const asker = ctx.memberIds[REQUESTED_INDEX];
  if (asker)
    await tx
      .insert(cityWaitlist)
      .values({ userId: asker, requestedName: 'Warangal', normalizedName: 'warangal' })
      .onConflictDoNothing();

  // Feature the next public Hyderabad plan (once; a later re-seed leaves a curator's choice alone).
  const already = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM events WHERE city_id = ${ctx.cityId} AND featured_until > now()`);
  if ((already.rows[0]?.n ?? 0) === 0)
    await tx.execute(sql`
      UPDATE events SET featured_until = ends_at, featured_rank = 1, featured_by = ${ctx.adminId}
      WHERE id = (
        SELECT id FROM events WHERE city_id = ${ctx.cityId} AND status = 'published' AND visibility = 'public'
          AND held_at IS NULL AND starts_at > ${now} AND type <> 'crew_session'
        ORDER BY starts_at LIMIT 1)`);

  // 30 days of overview counters for Hyderabad: an invented but plausible history (seed data only).
  const DAYS = 30;
  for (let d = 0; d < DAYS; d += 1) {
    // Local (IST) days, exactly as the worker counts them.
    const day = dayIn(new Date(now.getTime() - d * 86_400_000), 'Asia/Kolkata');
    const base = 20 + Math.round(10 * wobble(d));
    const values: Record<AnalyticsMetric, number> = {
      signed_up: Math.round(base * 0.4),
      onboarded: Math.round(base * 0.35),
      plan_created: Math.round(base * 0.15),
      pulled_up: base * 2,
      checked_in: Math.round(base * 1.4),
      payment_captured: Math.round(base * 0.1),
      revenue_paise: Math.round(base * 0.1) * 29_900,
      report_created: Math.round(2 * wobble(d + 100)),
      city_waitlist_joined: Math.round(3 * wobble(d + 200)),
    };
    for (const metric of ANALYTICS_METRICS)
      await tx
        .insert(analyticsDaily)
        .values({ day, cityId: ctx.cityId, metric, value: values[metric] })
        .onConflictDoNothing();
    const active = ctx.memberIds.slice(0, base + 20);
    await tx
      .insert(analyticsActive)
      .values(active.map((userId) => ({ day, userId, cityId: ctx.cityId })))
      .onConflictDoNothing();
  }

  const count = async (q: ReturnType<typeof sql>): Promise<number> =>
    (await tx.execute<{ n: number }>(q)).rows[0]?.n ?? 0;
  return {
    cities: await count(sql`SELECT count(*)::int AS n FROM cities`),
    waitlisted: await count(sql`SELECT count(*)::int AS n FROM city_waitlist`),
    curators: await count(
      sql`SELECT count(*)::int AS n FROM user_roles WHERE role = 'city_curator'`,
    ),
    featured: await count(sql`SELECT count(*)::int AS n FROM events WHERE featured_until > now()`),
    analyticsDays: await count(
      sql`SELECT count(DISTINCT day)::int AS n FROM analytics_daily WHERE city_id = ${ctx.cityId}`,
    ),
  };
}
