import {
  DEFAULT_RANKING_WEIGHTS,
  type FeedReason,
  type FeedWhen,
  type WeatherCondition,
} from '@touchgrass/shared';

/**
 * Rule-based ranking weights (F-DSC-07). Each feature is normalised to roughly 0–1 before weighting, so the
 * weights read as "how many points is a perfect match on this worth". Defaults live in shared; admins tune
 * them in the dashboard (`RankingWeightsService`, D-121), informed by `discovery_clicks` / `discovery_impressions`.
 */
export const DISCOVERY_WEIGHTS = DEFAULT_RANKING_WEIGHTS;
export type DiscoveryWeights = { [K in keyof typeof DISCOVERY_WEIGHTS]: number };

/** A reason is shown when its weighted contribution reaches this many points. */
export const REASON_THRESHOLD = 0.75;
const NEARBY_METERS = 3000;
const DISTANCE_SCALE_METERS = 5000;
const SOON_SCALE_HOURS = 48;
const FRESH_SCALE_HOURS = 72;

export interface RankFeatures {
  /** Matches between the plan's category + interests and the viewer's interests. */
  interestMatches: number;
  vibeMatches: number;
  squadGoing: number;
  /** People going (or hosting) whom the viewer reaches through their squad. */
  friendsOfFriendsGoing: number;
  distanceMeters: number;
  hoursUntilStart: number;
  /** Seats taken / capacity, 0–1. */
  fillRatio: number;
  soloFriendly: boolean;
  /** Small squads get solo-friendly plans boosted. */
  viewerSquadSize: number;
  /** +1 the weather suits the plan, −1 it works against it, 0 unknown/neutral. */
  weatherFit: -1 | 0 | 1;
  hoursSincePublished: number;
  /** The primary host's average rating (F-AFT-05), null until they have enough ratings. */
  hostRating: number | null;
}

const saturate = (n: number, half: number): number => (n <= 0 ? 0 : n / (n + half));

/** Score and explain one plan for one viewer. Pure: same features → same result. */
export function scoreEvent(
  f: RankFeatures,
  w: DiscoveryWeights = DISCOVERY_WEIGHTS,
): { score: number; reasons: FeedReason[] } {
  const parts: [FeedReason | null, number][] = [
    ['interests', w.interests * saturate(f.interestMatches, 1)],
    ['vibes', w.vibes * saturate(f.vibeMatches, 1)],
    ['squad_going', w.squadGoing * saturate(f.squadGoing, 1)],
    ['friends_of_friends', w.friendsOfFriends * saturate(f.friendsOfFriendsGoing, 1)],
    [
      f.distanceMeters <= NEARBY_METERS ? 'nearby' : null,
      w.distance * Math.exp(-f.distanceMeters / DISTANCE_SCALE_METERS),
    ],
    [
      'soon',
      w.soon * (f.hoursUntilStart <= 0 ? 1 : Math.exp(-f.hoursUntilStart / SOON_SCALE_HOURS)),
    ],
    // Filling but not full: social proof without dead ends.
    ['popular', w.popular * (f.fillRatio >= 1 ? 0.2 : f.fillRatio)],
    ['solo_friendly', f.soloFriendly ? w.soloFriendly * (f.viewerSquadSize < 5 ? 1 : 0.4) : 0],
    ['weather', w.weather * f.weatherFit],
    [null, w.fresh * Math.exp(-Math.max(0, f.hoursSincePublished) / FRESH_SCALE_HOURS)],
    // 3.5★ counts for nothing, 5★ for the full weight; unrated hosts are neutral, not penalised.
    [
      'top_host',
      f.hostRating === null
        ? 0
        : w.hostRating * Math.min(1, Math.max(0, (f.hostRating - 3.5) / 1.5)),
    ],
  ];
  let score = 0;
  const reasons: { reason: FeedReason; points: number }[] = [];
  for (const [reason, points] of parts) {
    score += points;
    if (reason && points >= REASON_THRESHOLD) reasons.push({ reason, points });
  }
  return {
    score: Math.round(score * 1000) / 1000,
    reasons: reasons.sort((a, b) => b.points - a.points).map((r) => r.reason),
  };
}

const IST_OFFSET_MS = 330 * 60_000;
const DAY = 86_400_000;

/** Start of the IST calendar day containing `t`, as a UTC instant. */
function istDayStart(t: Date): Date {
  const ist = t.getTime() + IST_OFFSET_MS;
  return new Date(Math.floor(ist / DAY) * DAY - IST_OFFSET_MS);
}

/**
 * Time windows for the quick chips (IST): tonight runs until 3 am, tomorrow is the next calendar day, the
 * weekend is Saturday 00:00 to Monday 00:00 (from now if it is already the weekend).
 */
export function timeWindow(
  when: FeedWhen,
  now: Date,
  horizonDays: number,
): { from: Date; to: Date } {
  const today = istDayStart(now);
  switch (when) {
    case 'any':
      return { from: now, to: new Date(now.getTime() + horizonDays * DAY) };
    case 'tonight':
      return { from: now, to: new Date(today.getTime() + DAY + 3 * 3_600_000) };
    case 'tomorrow':
      return { from: new Date(today.getTime() + DAY), to: new Date(today.getTime() + 2 * DAY) };
    case 'weekend': {
      const dow = new Date(today.getTime() + IST_OFFSET_MS).getUTCDay();
      if (dow === 6 || dow === 0) {
        const monday = new Date(today.getTime() + (dow === 6 ? 2 : 1) * DAY);
        return { from: now, to: monday };
      }
      const saturday = new Date(today.getTime() + (6 - dow) * DAY);
      return { from: saturday, to: new Date(saturday.getTime() + 2 * DAY) };
    }
  }
}

export interface WeatherAtStart {
  condition: WeatherCondition;
  tempC: number;
  precipitationProbability: number;
}

const WET: readonly WeatherCondition[] = ['rain', 'storm', 'drizzle'];

/**
 * F-DSC-08: rain (or a ≥60% chance), storms and heat ≥36 °C favour indoor plans; pleasant dry weather
 * (18–32 °C) favours outdoor ones.
 */
export function weatherFit(
  w: WeatherAtStart | null,
  indoor: boolean,
): { fit: -1 | 0 | 1; advice: 'indoor' | 'outdoor' | null } {
  if (!w) return { fit: 0, advice: null };
  const wet = WET.includes(w.condition) || w.precipitationProbability >= 0.6;
  const hot = w.tempC >= 36;
  if (wet || hot) return indoor ? { fit: 1, advice: 'indoor' } : { fit: -1, advice: null };
  const pleasant = w.tempC >= 18 && w.tempC <= 32;
  if (pleasant && !indoor) return { fit: 1, advice: 'outdoor' };
  return { fit: 0, advice: null };
}

/** Grid clustering for the map: cells of ~64 px at the given zoom (256 px tiles). */
export function clusterCellDegrees(zoom: number): number {
  return (360 / 2 ** zoom) * 0.25;
}

export function clusterPoints<T extends { lat: number; lng: number }>(
  points: T[],
  zoom: number,
  minClusterSize = 3,
): { singles: T[]; clusters: { lat: number; lng: number; count: number }[] } {
  if (zoom >= 16) return { singles: points, clusters: [] };
  const cell = clusterCellDegrees(zoom);
  const cells = new Map<string, T[]>();
  for (const p of points) {
    const key = `${String(Math.floor(p.lat / cell))}:${String(Math.floor(p.lng / cell))}`;
    cells.set(key, [...(cells.get(key) ?? []), p]);
  }
  const singles: T[] = [];
  const clusters: { lat: number; lng: number; count: number }[] = [];
  for (const group of cells.values()) {
    if (group.length < minClusterSize) singles.push(...group);
    else
      clusters.push({
        lat: group.reduce((s, p) => s + p.lat, 0) / group.length,
        lng: group.reduce((s, p) => s + p.lng, 0) / group.length,
        count: group.length,
      });
  }
  return { singles, clusters };
}
