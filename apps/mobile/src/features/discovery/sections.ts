import { type FeedItem, zonedParts } from '@touchgrass/shared';

export type RailKey = 'squad' | 'tonight' | 'weekend' | 'solo';

export interface FeedSections {
  /** Big swipeable cards at the top: featured plans first, then the best-ranked ones. */
  hero: FeedItem[];
  /** Sideways rows by theme; a row only appears with at least two plans. */
  rails: { key: RailKey; items: FeedItem[] }[];
}

const HERO_MAX = 5;
const RAIL_MAX = 10;
/** Below this many plans the sections add nothing: the plain list is shown instead. */
export const SECTIONS_MIN_ITEMS = 3;

const sameDay = (a: Date, b: Date, tz: string): boolean => {
  const x = zonedParts(a, tz);
  const y = zonedParts(b, tz);
  return x.year === y.year && x.month === y.month && x.day === y.day;
};

/**
 * Explore's layout (D-155), from the ranked feed the viewer already has (no extra request, same privacy):
 * a hero carousel and themed rails. Dates are judged in each plan's own city time zone.
 */
export function buildSections(items: FeedItem[], now: Date = new Date()): FeedSections {
  if (items.length < SECTIONS_MIN_ITEMS) return { hero: [], rails: [] };
  const featured = items.filter((i) => i.reasons.includes('featured'));
  const hero = [...featured, ...items.filter((i) => !featured.includes(i))].slice(0, HERO_MAX);
  const weekendDays = (i: FeedItem): boolean => {
    const start = new Date(i.startsAt);
    const ahead = start.getTime() - now.getTime();
    const day = zonedParts(start, i.timezone).weekday;
    return ahead > 0 && ahead < 7 * 86_400_000 && (day === 6 || day === 7);
  };
  const candidates: { key: RailKey; test: (i: FeedItem) => boolean }[] = [
    { key: 'squad', test: (i) => i.reasons.includes('squad_going') || i.via !== null },
    { key: 'tonight', test: (i) => sameDay(new Date(i.startsAt), now, i.timezone) },
    { key: 'weekend', test: weekendDays },
    { key: 'solo', test: (i) => i.soloFriendly },
  ];
  const rails = candidates
    .map((c) => ({ key: c.key, items: items.filter(c.test).slice(0, RAIL_MAX) }))
    .filter((r) => r.items.length >= 2);
  return { hero, rails };
}
