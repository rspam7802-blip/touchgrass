import type { FeedItem } from '@touchgrass/shared';
import { buildSections } from './sections';

const now = new Date('2026-11-04T06:00:00.000Z'); // Wednesday 11:30 IST
const plan = (n: number, over: Partial<FeedItem> = {}): FeedItem =>
  ({
    id: `0192f3a4-5b6c-7d8e-9f01-${String(n).padStart(12, '0')}`,
    startsAt: '2026-11-10T12:00:00.000Z',
    timezone: 'Asia/Kolkata',
    reasons: [],
    via: null,
    soloFriendly: false,
    ...over,
  }) as FeedItem;

describe('Explore sections', () => {
  it('skips the carousel for small feeds', () => {
    expect(buildSections([plan(1), plan(2)], now)).toEqual({ hero: [], rails: [] });
  });

  it('adds near-you, free, small-group, mystery and picked-for-you rows, never a row of every plan', () => {
    const items = [
      plan(1, { distanceMeters: 800, pricePaise: 0, smallGroup: true }),
      plan(2, { distanceMeters: 1200, pricePaise: 0, smallGroup: true, mystery: true }),
      plan(3, { distanceMeters: 9000, pricePaise: 0, mystery: true, reasons: ['interests'] }),
      plan(4, { distanceMeters: 9000, pricePaise: 50000, reasons: ['vibes'] }),
    ];
    const keys = buildSections(items, now).rails.map((r) => r.key);
    expect(keys).toEqual(['near', 'small', 'free', 'mystery', 'forYou']);
  });

  it('puts featured plans first in the carousel, up to five', () => {
    const items = [1, 2, 3, 4, 5, 6].map((n) => plan(n, n === 4 ? { reasons: ['featured'] } : {}));
    expect(buildSections(items, now).hero.map((i) => i.id.slice(-1))).toEqual([
      '4',
      '1',
      '2',
      '3',
      '5',
    ]);
  });

  it('builds rails for squad, tonight (in the plan’s zone), weekend and solo, only with two or more', () => {
    const items = [
      plan(1, { reasons: ['squad_going'] }),
      plan(2, { via: {} as FeedItem['via'] }),
      plan(3, { startsAt: '2026-11-04T14:00:00.000Z' }), // 19:30 IST today
      plan(4, { startsAt: '2026-11-04T17:00:00.000Z' }), // 22:30 IST today
      plan(5, { startsAt: '2026-11-04T19:00:00.000Z' }), // 00:30 IST tomorrow: not tonight
      plan(6, { startsAt: '2026-11-07T10:00:00.000Z' }), // Saturday
      plan(7, { soloFriendly: true }),
    ];
    const rails = buildSections(items, now).rails;
    expect(rails.map((r) => [r.key, r.items.map((i) => i.id.slice(-1))])).toEqual([
      ['squad', ['1', '2']],
      ['tonight', ['3', '4']],
    ]);
  });
});
