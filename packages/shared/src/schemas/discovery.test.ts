import { describe, expect, it } from 'vitest';
import { DiscoveryFilters, FeedClickBody, FeedQuery, MapQuery, SearchQuery } from './discovery';

const ID = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';

describe('discovery schemas (F-DSC-01/02/03/09)', () => {
  it('feed query defaults and query-string parsing', () => {
    expect(FeedQuery.parse({})).toMatchObject({
      radiusKm: 10,
      sort: 'recommended',
      limit: 20,
      when: 'any',
    });
    const q = FeedQuery.parse({
      lat: '17.44',
      lng: '78.35',
      free: 'true',
      smallGroup: 'false',
      interestIds: `${ID},${ID}`,
    });
    expect(q).toMatchObject({
      lat: 17.44,
      lng: 78.35,
      free: true,
      smallGroup: false,
      interestIds: [ID, ID],
    });
  });

  it('rejects ambiguous or unsafe input', () => {
    expect(FeedQuery.safeParse({ lat: '17.44' }).success).toBe(false);
    expect(FeedQuery.safeParse({ free: '1' }).success).toBe(false);
    expect(FeedQuery.safeParse({ interestIds: 'not-a-uuid' }).success).toBe(false);
    expect(FeedQuery.safeParse({ radiusKm: '500' }).success).toBe(false);
    expect(
      DiscoveryFilters.safeParse({
        from: '2026-11-05T00:00:00.000Z',
        to: '2026-11-04T00:00:00.000Z',
      }).success,
    ).toBe(false);
    expect(
      FeedQuery.safeParse({ from: '2026-11-05T00:00:00.000Z', to: '2026-11-04T00:00:00.000Z' })
        .success,
    ).toBe(false);
  });

  it('map boxes must be ordered and small', () => {
    expect(MapQuery.parse({ bbox: '78.3,17.4,78.4,17.5' })).toMatchObject({
      bbox: [78.3, 17.4, 78.4, 17.5],
      zoom: 13,
    });
    expect(MapQuery.safeParse({ bbox: '78.4,17.5,78.3,17.4' }).success).toBe(false);
    expect(MapQuery.safeParse({ bbox: '70,10,78,18' }).success).toBe(false);
    expect(MapQuery.safeParse({ bbox: '78.3,17.4' }).success).toBe(false);
    expect(
      MapQuery.safeParse({
        bbox: '78.3,17.4,78.4,17.5',
        from: '2026-11-05T00:00:00.000Z',
        to: '2026-11-04T00:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('search and clicks', () => {
    expect(SearchQuery.parse({ q: '  chai ' })).toMatchObject({
      q: 'chai',
      type: 'all',
      limit: 10,
    });
    expect(SearchQuery.safeParse({ q: 'c' }).success).toBe(false);
    expect(FeedClickBody.safeParse({ requestId: ID, eventId: ID, position: 3 }).success).toBe(true);
    expect(FeedClickBody.safeParse({ requestId: ID, eventId: ID, position: -1 }).success).toBe(
      false,
    );
  });
});
