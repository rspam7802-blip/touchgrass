import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import * as schema from '../src/infra/database/schema/index.js';
import { seed } from '../src/seed/seed.js';
import { MemoryObjectStorage } from '../src/adapters/storage/memory.storage.js';
import { integrationEnv } from './helpers.js';

describe('seed', () => {
  const pool = new pg.Pool({ connectionString: integrationEnv().DATABASE_URL, max: 2 });
  afterAll(async () => {
    await pool.end();
  });

  it('is idempotent and places every neighbourhood inside Hyderabad', async () => {
    const db = drizzle(pool, { schema });
    const first = await seed(db);
    const second = await seed(db);
    expect(second).toEqual(first);
    expect(first.friendships).toBeGreaterThanOrEqual(800);
    expect(first.neighbourhoods).toBeGreaterThanOrEqual(5);
    const { rows } = await pool.query<{ slug: string; inside: boolean; contains: boolean }>(
      `SELECT n.slug, ST_Covers(c.bounds, n.boundary) AS inside, ST_Covers(n.boundary, n.centroid) AS contains
         FROM neighbourhoods n JOIN cities c ON c.id = n.city_id WHERE c.slug = 'hyderabad' ORDER BY n.slug`,
    );
    expect(rows.map((r) => r.slug)).toEqual([
      'banjara-hills',
      'gachibowli',
      'jubilee-hills',
      'kondapur',
      'madhapur',
    ]);
    expect(rows.every((r) => r.inside && r.contains)).toBe(true);
  });

  it('seeds 50 venues and 100 events across every type, visibility and state', async () => {
    const db = drizzle(pool, { schema });
    const storage = new MemoryObjectStorage('http://media.test');
    const summary = await seed(db, {
      tokenPepper: 'seed-test-pepper-seed-test-pepper-0123',
      storage,
    });
    expect(summary).toMatchObject({ venues: 50, events: 100 });
    // Phase 6: hosts, paid plans with payments and payouts, partner venues with perks and staff PINs.
    expect(summary.payments).toMatchObject({ paidEvents: 6, payouts: 2 });
    expect(summary.payments.hostApplications).toBeGreaterThanOrEqual(4);
    expect(summary.payments.payments).toBeGreaterThanOrEqual(20);
    expect(summary.payments.partnerVenues).toBeGreaterThan(0);
    expect(summary.payments.perks).toBe(summary.payments.partnerVenues);
    const { rows: pins } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM venues WHERE is_partner AND staff_pin_hash IS NULL AND google_place_id LIKE 'seed\\_%'`,
    );
    expect(pins[0]?.n).toBe(0);
    // Phase 7: feedback, host ratings, reliability from attendance, Lore with real (generated) images.
    expect(summary.after.feedback).toBeGreaterThan(50);
    expect(summary.after.hostRatings).toBe(summary.after.feedback);
    expect(summary.after.reliabilityScores).toBeGreaterThan(50);
    expect(summary.after.loreItems).toBeGreaterThanOrEqual(10);
    // Phase 8: crews with schedules, free-now, plan votes, gamification backfill, challenges, referrals.
    expect(summary.engagement.crews).toBeGreaterThanOrEqual(4);
    expect(summary.engagement.crewMembers).toBeGreaterThanOrEqual(19);
    expect(summary.engagement.available).toBeGreaterThanOrEqual(3);
    expect(summary.engagement.proposals).toBeGreaterThanOrEqual(2);
    expect(summary.engagement.facts).toBeGreaterThan(50);
    expect(summary.engagement.badgesEarned).toBeGreaterThan(10);
    expect(summary.engagement.challenges).toBeGreaterThanOrEqual(2);
    expect(summary.engagement.referralCodes).toBeGreaterThanOrEqual(12);
    // Phase 9: trusted contacts, selfies in the verification queue, held text, a warning on record.
    expect(summary.safety.trustedContacts).toBeGreaterThanOrEqual(2);
    expect(summary.safety.pendingVerifications).toBeGreaterThanOrEqual(2);
    expect(summary.safety.heldItems).toBeGreaterThanOrEqual(2);
    expect(summary.safety.sanctions).toBeGreaterThanOrEqual(1);
    // Phase 10: an inbox for member #2.
    expect(summary.notifications.inboxItems).toBeGreaterThanOrEqual(2);
    // Phase 11: more cities as data, curators, a waitlist, a featured plan, overview history.
    expect(summary.adminConsole.cities).toBeGreaterThanOrEqual(3);
    expect(summary.adminConsole.curators).toBeGreaterThanOrEqual(2);
    expect(summary.adminConsole.waitlisted).toBeGreaterThanOrEqual(6);
    expect(summary.adminConsole.featured).toBeGreaterThanOrEqual(1);
    expect(summary.adminConsole.analyticsDays).toBe(30);
    const { rows: tiers } = await pool.query<{ tier: string }>(
      'SELECT DISTINCT tier FROM reliability_scores',
    );
    expect(tiers.length).toBeGreaterThan(1);
    const { rows: lore } = await pool.query<{ k: { lg: string } }>(
      `SELECT m.variant_keys AS k FROM lore_items l
         JOIN media_assets m ON m.id = l.media_id JOIN events e ON e.id = l.event_id
       WHERE e.slug LIKE 'seedev%' ORDER BY l.created_at DESC LIMIT 1`,
    );
    expect((await storage.get(lore[0]?.k.lg ?? '')).length).toBeGreaterThan(0);
    expect(summary.rsvps).toBeGreaterThan(500);
    expect(summary.chat).toMatchObject({ icebreakers: 20 });
    expect(summary.chat.conversations).toBeGreaterThanOrEqual(25);
    expect(summary.chat.messages).toBeGreaterThanOrEqual(80);
    const { rows: shape } = await pool.query<{ k: string }>(
      `SELECT DISTINCT 'v:' || visibility AS k FROM events WHERE slug LIKE 'seedev%'
       UNION SELECT DISTINCT 's:' || status FROM events WHERE slug LIKE 'seedev%'
       UNION SELECT DISTINCT 't:' || type FROM events WHERE slug LIKE 'seedev%'
       UNION SELECT DISTINCT 'r:' || r.status FROM rsvps r JOIN events e ON e.id = r.event_id WHERE e.slug LIKE 'seedev%'`,
    );
    expect(shape.map((r) => r.k).sort()).toEqual(
      [
        'r:cancelled',
        'r:checked_in',
        'r:going',
        'r:waitlisted',
        's:cancelled',
        's:completed',
        's:published',
        't:curated',
        't:plan',
        'v:balanced',
        'v:friends_of_friends',
        'v:invite_only',
        'v:public',
        'v:women_only',
      ].sort(),
    );
    const { rows: over } = await pool.query(
      `SELECT e.slug FROM events e JOIN rsvps r ON r.event_id = e.id AND r.status IN ('going','checked_in')
       WHERE e.slug LIKE 'seedev%' GROUP BY e.id HAVING count(*) > e.capacity`,
    );
    expect(over).toEqual([]);
    const { rows: mystery } = await pool.query<{ d: number }>(
      `SELECT ST_Distance(location, approx_center) AS d FROM events WHERE slug LIKE 'seedev%' AND mystery`,
    );
    expect(mystery.length).toBeGreaterThan(0);
    expect(mystery.every((m) => m.d >= 999)).toBe(true);
    const { rows: hosts } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM events e JOIN users u ON u.id = e.creator_user_id
       LEFT JOIN user_roles ur ON ur.user_id = u.id
       WHERE e.slug LIKE 'seedev%' AND u.verified_at IS NULL AND ur.id IS NULL`,
    );
    expect(hosts[0]?.n).toBe(0);
  });

  it('supports geography distance queries with the GIST index', async () => {
    const { rows } = await pool.query<{ slug: string }>(
      `SELECT slug FROM neighbourhoods ORDER BY centroid <-> ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography LIMIT 1`,
      [78.39, 17.447],
    );
    expect(rows[0]?.slug).toBe('madhapur');
  });
});
