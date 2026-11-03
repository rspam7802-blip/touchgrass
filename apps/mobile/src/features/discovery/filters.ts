import type { FeedSort, FeedWhen, GeoPoint } from '@touchgrass/shared';

/** Everything the Discover screen can filter on (F-DSC-02); serialised to the API's query string. */
export interface DiscoverFilters {
  when: FeedWhen;
  sort: FeedSort;
  radiusKm: number;
  categoryId: string | null;
  vibeTagIds: string[];
  free: boolean;
  smallGroup: boolean;
  soloFriendly: boolean;
  womenOnly: boolean;
  squadGoing: boolean;
  indoor: boolean;
  stepFree: boolean;
}

export const DEFAULT_FILTERS: DiscoverFilters = {
  when: 'any',
  sort: 'recommended',
  radiusKm: 10,
  categoryId: null,
  vibeTagIds: [],
  free: false,
  smallGroup: false,
  soloFriendly: false,
  womenOnly: false,
  squadGoing: false,
  indoor: false,
  stepFree: false,
};

export const TOGGLES = [
  'free',
  'smallGroup',
  'soloFriendly',
  'squadGoing',
  'womenOnly',
  'indoor',
  'stepFree',
] as const;
export type Toggle = (typeof TOGGLES)[number];

/** Number of filters that differ from the defaults (shown on the Filters button). */
export function activeFilterCount(f: DiscoverFilters): number {
  let n = TOGGLES.filter((k) => f[k]).length;
  if (f.when !== 'any') n += 1;
  if (f.radiusKm !== DEFAULT_FILTERS.radiusKm) n += 1;
  if (f.categoryId) n += 1;
  if (f.vibeTagIds.length > 0) n += 1;
  return n;
}

/** Query parameters shared by the feed and the map (sort/radius only apply to the feed). */
export function filterParams(f: DiscoverFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (f.when !== 'any') p.set('when', f.when);
  if (f.categoryId) p.set('categoryId', f.categoryId);
  if (f.vibeTagIds.length > 0) p.set('vibeTagIds', f.vibeTagIds.join(','));
  for (const k of TOGGLES) if (f[k]) p.set(k, 'true');
  return p;
}

export function feedParams(f: DiscoverFilters, location: GeoPoint | null): URLSearchParams {
  const p = filterParams(f);
  p.set('sort', f.sort);
  p.set('radiusKm', String(f.radiusKm));
  if (location) {
    p.set('lat', location.lat.toFixed(5));
    p.set('lng', location.lng.toFixed(5));
  }
  return p;
}

/** Map region → API bounding box and an approximate web-mercator zoom level. */
export function regionToBox(r: {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}): {
  bbox: string;
  zoom: number;
} {
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
  const latD = Math.min(r.latitudeDelta, 2);
  const lngD = Math.min(r.longitudeDelta, 2);
  const box = [
    clamp(r.longitude - lngD / 2, -180, 180),
    clamp(r.latitude - latD / 2, -90, 90),
    clamp(r.longitude + lngD / 2, -180, 180),
    clamp(r.latitude + latD / 2, -90, 90),
  ].map((v) => v.toFixed(4));
  const zoom = clamp(Math.round(Math.log2(360 / Math.max(r.longitudeDelta, 1e-6))), 3, 20);
  return { bbox: box.join(','), zoom };
}
