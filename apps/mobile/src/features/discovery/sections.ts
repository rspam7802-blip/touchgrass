import { type FeedItem, zonedParts } from '@touchgrass/shared';

export type RailKey =
  | 'squad'
  | 'tonight'
  | 'weekend'
  | 'solo'
  | 'near'
  | 'fof'
  | 'small'
  | 'free'
  | 'mystery'
  | 'popular'
  | 'forYou';

export interface FeedSections {
  /** Big swipeable cards at the top: featured plans first, then the best-ranked ones. */
  hero: FeedItem[];
  /** Sideways rows by theme; a row only appears with at least two plans. Every plan also sits in the
   *  final "All plans" row, so nothing is only reachable through a theme. */
  rails: { key: RailKey; items: FeedItem[] }[];
}

const HERO_MAX = 5;
const RAIL_MAX = 12;
/** The carousel needs a few plans to feel like one. */
const HERO_MIN_ITEMS = 3;
/** "Near you" means within this distance of the plan's public centre. */
const NEAR_METERS = 3000;

const sameDay = (a: Date, b: Date, tz: string): boolean => {
  const x = zonedParts(a, tz);
  const y = zonedParts(b, tz);
  return x.year === y.year && x.month === y.month && x.day === y.day;
};

/**
 * Explore's layout (D-155, D-160), from the ranked feed the viewer already has (no extra request, same privacy):
 * a hero carousel and themed rails. Dates are judged in each plan's own city time zone.
 */
export function buildSections(items: FeedItem[], now: Date = new Date()): FeedSections {
  const featured = items.filter((i) => i.reasons.includes('featured'));
  const hero =
    items.length < HERO_MIN_ITEMS
      ? []
      : [...featured, ...items.filter((i) => !featured.includes(i))].slice(0, HERO_MAX);
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
    { key: 'near', test: (i) => i.reasons.includes('nearby') || i.distanceMeters <= NEAR_METERS },
    { key: 'fof', test: (i) => i.reasons.includes('friends_of_friends') },
    { key: 'small', test: (i) => i.smallGroup },
    { key: 'free', test: (i) => i.pricePaise === 0 },
    { key: 'mystery', test: (i) => i.mystery },
    {
      key: 'popular',
      test: (i) => i.reasons.includes('popular') || i.reasons.includes('top_host'),
    },
    { key: 'forYou', test: (i) => i.reasons.includes('interests') || i.reasons.includes('vibes') },
  ];
  const rails = candidates
    .map((c) => ({ key: c.key, items: items.filter(c.test).slice(0, RAIL_MAX) }))
    // A row needs two plans, and a row that holds every plan says nothing "All plans" doesn't.
    .filter((r) => r.items.length >= 2 && (r.items.length < items.length || items.length <= 3));
  return { hero, rails };
}
