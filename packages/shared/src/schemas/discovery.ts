import { z } from 'zod';
import { GeoPoint } from './common';
import { EventSummary, Venue } from './events';
import { CrewSummary } from './engagement';
import { PersonCard } from './social';

/** Query-string boolean: only the literal strings "true"/"false" (z.coerce.boolean would read "false" as true). */
const QueryFlag = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true')
  .optional();
const IdList = z
  .string()
  .max(400)
  .transform((s) => s.split(',').filter((x) => x.length > 0))
  .pipe(z.array(z.uuid()).max(10))
  .optional();

export const FEED_WHEN = ['any', 'tonight', 'tomorrow', 'weekend'] as const;
export const FeedWhen = z.enum(FEED_WHEN);
export type FeedWhen = z.infer<typeof FeedWhen>;

/** Filters shared by the feed and the map (F-DSC-02). */
const filterShape = {
  when: FeedWhen.default('any'),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  categoryId: z.uuid().optional(),
  interestIds: IdList,
  vibeTagIds: IdList,
  free: QueryFlag,
  maxPricePaise: z.coerce.number().int().min(0).max(10_000_000).optional(),
  smallGroup: QueryFlag,
  soloFriendly: QueryFlag,
  womenOnly: QueryFlag,
  squadGoing: QueryFlag,
  indoor: QueryFlag,
  stepFree: QueryFlag,
  accessibleRestroom: QueryFlag,
  quietSpace: QueryFlag,
};
const rangeOk = (f: { from?: string; to?: string }): boolean =>
  !f.from || !f.to || new Date(f.from) < new Date(f.to);
const RANGE_ISSUE = { message: 'from must be before to', path: ['to'] };
export const DiscoveryFilters = z.object(filterShape).refine(rangeOk, RANGE_ISSUE);
export type DiscoveryFilters = z.infer<typeof DiscoveryFilters>;

export const FeedSort = z.enum(['recommended', 'soonest', 'nearest']);
export type FeedSort = z.infer<typeof FeedSort>;

const Coords = {
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
};

export const FeedQuery = z
  .object({
    ...Coords,
    radiusKm: z.coerce.number().int().min(1).max(50).default(50),
    sort: FeedSort.default('recommended'),
    cursor: z.string().max(512).optional(),
    limit: z.coerce.number().int().min(1).max(30).default(20),
    ...filterShape,
  })
  .refine(rangeOk, RANGE_ISSUE)
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), {
    message: 'lat and lng go together',
    path: ['lng'],
  });
export type FeedQuery = z.infer<typeof FeedQuery>;

/** Why a plan is in your feed (explainable, never random — F-DSC-07). */
export const FeedReason = z.enum([
  'interests',
  'vibes',
  'squad_going',
  'friends_of_friends',
  'nearby',
  'soon',
  'popular',
  'solo_friendly',
  'weather',
  'top_host',
  'featured',
]);
export type FeedReason = z.infer<typeof FeedReason>;

export const WeatherCondition = z.enum([
  'clear',
  'clouds',
  'rain',
  'storm',
  'drizzle',
  'mist',
  'other',
]);
export type WeatherCondition = z.infer<typeof WeatherCondition>;
export const WeatherNow = z.object({
  tempC: z.number(),
  condition: WeatherCondition,
  precipitationProbability: z.number().min(0).max(1),
});
export type WeatherNow = z.infer<typeof WeatherNow>;
/** Forecast at the plan's start and what it means for an indoor/outdoor plan (F-DSC-08). */
export const WeatherHint = WeatherNow.extend({ advice: z.enum(['indoor', 'outdoor']).nullable() });
export type WeatherHint = z.infer<typeof WeatherHint>;

export const FeedItem = EventSummary.extend({
  /** "Who's pulling up" preview: squad first, then people you share mutuals with (F-DSC-05). */
  preview: z.object({ people: z.array(PersonCard), total: z.number().int() }),
  /** A squad member hosting or going, for plans reached through friends of friends (F-DSC-06). */
  via: PersonCard.nullable(),
  reasons: z.array(FeedReason),
  /** Distance to the plan's public centre (approximate for mystery plans). */
  distanceMeters: z.number().int(),
  weather: WeatherHint.nullable(),
});
export type FeedItem = z.infer<typeof FeedItem>;

export const Feed = z.object({
  items: z.array(FeedItem),
  nextCursor: z.string().nullable(),
  /** Identifies this ranked snapshot; sent back with clicks. */
  requestId: z.uuid(),
  center: GeoPoint,
  weather: WeatherNow.nullable(),
});
export type Feed = z.infer<typeof Feed>;

export const FeedClickBody = z.object({
  requestId: z.uuid(),
  eventId: z.uuid(),
  position: z.number().int().min(0).max(1000),
});
export type FeedClickBody = z.infer<typeof FeedClickBody>;

const BBox = z
  .string()
  .max(100)
  .transform((s) => s.split(',').map(Number))
  .pipe(
    z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ]),
  )
  .refine(([minLng, minLat, maxLng, maxLat]) => minLng < maxLng && minLat < maxLat, {
    message: 'bbox must be minLng,minLat,maxLng,maxLat',
  })
  .refine(([minLng, minLat, maxLng, maxLat]) => maxLng - minLng <= 2 && maxLat - minLat <= 2, {
    message: 'bbox too large',
  });

export const MapQuery = z
  .object({ bbox: BBox, zoom: z.coerce.number().int().min(3).max(20).default(13), ...filterShape })
  .refine(rangeOk, RANGE_ISSUE);
export type MapQuery = z.infer<typeof MapQuery>;

export const MapPin = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  center: GeoPoint,
  /** 0 for exact pins; the fuzz radius for unrevealed mystery plans (drawn as a circle). */
  radiusMeters: z.number().int(),
  mystery: z.boolean(),
  startsAt: z.iso.datetime(),
  emoji: z.string().nullable(),
});
export type MapPin = z.infer<typeof MapPin>;
export const MapCluster = z.object({ center: GeoPoint, count: z.number().int() });
export type MapCluster = z.infer<typeof MapCluster>;
export const MapResponse = z.object({
  pins: z.array(MapPin),
  clusters: z.array(MapCluster),
  /** More plans matched than the map shows; zoom in or filter. */
  truncated: z.boolean(),
});
export type MapResponse = z.infer<typeof MapResponse>;

export const SearchType = z.enum(['all', 'events', 'people', 'venues', 'crews']);
export const SearchQuery = z.object({
  q: z.string().trim().min(2).max(80),
  type: SearchType.default('all'),
  limit: z.coerce.number().int().min(1).max(20).default(10),
  ...Coords,
});
export type SearchQuery = z.infer<typeof SearchQuery>;
export const SearchResponse = z.object({
  events: z.array(EventSummary),
  people: z.array(PersonCard),
  venues: z.array(Venue),
  /** Crews you're in, and open crews you could ask to join (F-ENG-02). */
  crews: z.array(CrewSummary).default([]),
});
export type SearchResponse = z.infer<typeof SearchResponse>;
