import { describe, expect, it } from 'vitest';
import {
  ADMIN_SECTION_KEYS,
  ADMIN_SECTIONS,
  AdminEventQuery,
  AnalyticsOverviewQuery,
  canAccessSection,
  DEFAULT_RANKING_WEIGHTS,
  FeatureEventBody,
  GrantRoleBody,
  isStaff,
  JoinCityWaitlistBody,
  placeholdersOf,
  RankingWeightsBody,
  UpsertCityBody,
  UpsertInterestBody,
} from './admin-console';

const CITY = {
  slug: 'hyderabad',
  name: 'Hyderabad',
  centre: { lat: 17.385, lng: 78.4867 },
  bounds: { south: 17.2, west: 78.2, north: 17.6, east: 78.7 },
  timezone: 'Asia/Kolkata',
  launchStatus: 'beta',
  languages: ['en', 'te', 'hi'],
} as const;
const USER = '01a191b3-b484-7df4-b0a2-89dfe5eef7c7';

describe('admin sections', () => {
  it('lets super admins into everything and nobody else into team or flags', () => {
    for (const s of ADMIN_SECTION_KEYS) expect(canAccessSection(['super_admin'], s)).toBe(true);
    expect(canAccessSection(['admin'], 'team')).toBe(false);
    expect(canAccessSection(['admin'], 'featureFlags')).toBe(false);
  });

  it('keeps curators to city content and support to people and money', () => {
    expect(canAccessSection(['city_curator'], 'events')).toBe(true);
    expect(canAccessSection(['city_curator'], 'payments')).toBe(false);
    expect(canAccessSection(['city_curator'], 'taxonomy')).toBe(false);
    expect(canAccessSection(['support'], 'payments')).toBe(true);
    expect(canAccessSection(['support'], 'events')).toBe(false);
    expect(canAccessSection([], 'dashboard')).toBe(false);
  });

  it('every section names at least one role and the dashboard is open to all staff', () => {
    for (const s of ADMIN_SECTION_KEYS) expect(ADMIN_SECTIONS[s].length).toBeGreaterThan(0);
    for (const r of ['admin', 'moderator', 'city_curator', 'support'])
      expect(canAccessSection([r], 'dashboard')).toBe(true);
  });

  it('recognises staff', () => {
    expect(isStaff(['support'])).toBe(true);
    expect(isStaff([])).toBe(false);
    expect(isStaff(['member'])).toBe(false);
  });
});

describe('cities', () => {
  it('accepts a well-formed city', () => {
    expect(UpsertCityBody.parse(CITY).timezone).toBe('Asia/Kolkata');
  });

  it('rejects unknown zones, inverted bounds, a centre outside them and repeated languages', () => {
    expect(UpsertCityBody.safeParse({ ...CITY, timezone: 'Mars/Olympus' }).success).toBe(false);
    expect(
      UpsertCityBody.safeParse({ ...CITY, bounds: { ...CITY.bounds, north: 17.1 } }).success,
    ).toBe(false);
    expect(UpsertCityBody.safeParse({ ...CITY, centre: { lat: 18, lng: 78.4 } }).success).toBe(
      false,
    );
    expect(UpsertCityBody.safeParse({ ...CITY, languages: ['en', 'en'] }).success).toBe(false);
    expect(UpsertCityBody.safeParse({ ...CITY, slug: 'Hyd City' }).success).toBe(false);
  });

  it('joins a waitlist by city or by name', () => {
    expect(JoinCityWaitlistBody.safeParse({ cityId: USER }).success).toBe(true);
    expect(JoinCityWaitlistBody.safeParse({ cityName: 'Vizag' }).success).toBe(true);
    expect(JoinCityWaitlistBody.safeParse({ cityName: 'V' }).success).toBe(false);
  });
});

describe('team', () => {
  it('requires a city for curators and only for curators', () => {
    expect(GrantRoleBody.safeParse({ userId: USER, role: 'city_curator' }).success).toBe(false);
    expect(
      GrantRoleBody.safeParse({ userId: USER, role: 'city_curator', cityId: USER }).success,
    ).toBe(true);
    expect(GrantRoleBody.safeParse({ userId: USER, role: 'moderator', cityId: USER }).success).toBe(
      false,
    );
    expect(GrantRoleBody.parse({ userId: USER, role: 'support' }).cityId).toBeNull();
  });
});

describe('events and taxonomy', () => {
  it('parses list filters from a query string', () => {
    const q = AdminEventQuery.parse({ featured: 'true', limit: '10' });
    expect(q).toMatchObject({ featured: true, limit: 10 });
    expect(AdminEventQuery.safeParse({ limit: '500' }).success).toBe(false);
  });

  it('features with rank 1 by default', () => {
    expect(FeatureEventBody.parse({ until: '2026-12-01T00:00:00.000Z' }).rank).toBe(1);
  });

  it('needs all three language names on taxonomy', () => {
    expect(
      UpsertInterestBody.safeParse({
        slug: 'board-games',
        name: { en: 'Board games', te: 'బోర్డ్ గేమ్స్', hi: '' },
        emoji: '🎲',
        category: 'games',
      }).success,
    ).toBe(false);
  });
});

describe('weights', () => {
  it('accepts the defaults and rejects out-of-range or missing weights', () => {
    expect(RankingWeightsBody.safeParse(DEFAULT_RANKING_WEIGHTS).success).toBe(true);
    expect(RankingWeightsBody.safeParse({ ...DEFAULT_RANKING_WEIGHTS, popular: 11 }).success).toBe(
      false,
    );
    expect(RankingWeightsBody.safeParse({ ...DEFAULT_RANKING_WEIGHTS, popular: 1.1 }).success).toBe(
      false,
    );
    const { fresh: _fresh, ...missing } = DEFAULT_RANKING_WEIGHTS;
    expect(RankingWeightsBody.safeParse(missing).success).toBe(false);
  });
});

describe('templates and analytics', () => {
  it('lists placeholders once, in order', () => {
    expect(placeholdersOf('{{name}} and {{ count }} more, {{name}}')).toEqual(['name', 'count']);
    expect(placeholdersOf('No params')).toEqual([]);
  });

  it('only offers 7, 30 or 90 days', () => {
    expect(AnalyticsOverviewQuery.parse({}).days).toBe(7);
    expect(AnalyticsOverviewQuery.parse({ days: '30' }).days).toBe(30);
    expect(AnalyticsOverviewQuery.safeParse({ days: '14' }).success).toBe(false);
  });
});
