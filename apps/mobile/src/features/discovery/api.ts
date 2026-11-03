import { useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query';
import { Feed, type GeoPoint, MapResponse, SearchResponse } from '@touchgrass/shared';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';
import { type DiscoverFilters, feedParams, filterParams } from './filters';

const Empty = z.undefined();

export const DISCOVER_KEYS = {
  feed: (f: DiscoverFilters, loc: GeoPoint | null) => ['discover', 'feed', f, loc] as const,
  map: (bbox: string, zoom: number, f: DiscoverFilters) =>
    ['discover', 'map', bbox, zoom, f] as const,
  search: (q: string, type: string) => ['discover', 'search', q, type] as const,
};

/** Ranked feed; pages share one server snapshot, so the order stays stable while scrolling (F-DSC-01). */
export function useFeed(filters: DiscoverFilters, location: GeoPoint | null) {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: DISCOVER_KEYS.feed(filters, location),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => {
      const p = feedParams(filters, location);
      p.set('limit', '20');
      if (pageParam) p.set('cursor', pageParam);
      return client.request(`/v1/discover/feed?${p.toString()}`, Feed, { signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useMapPins(box: { bbox: string; zoom: number } | null, filters: DiscoverFilters) {
  const { client } = useApi();
  return useQuery({
    queryKey: DISCOVER_KEYS.map(box?.bbox ?? '', box?.zoom ?? 0, filters),
    enabled: box !== null,
    queryFn: ({ signal }) => {
      const p = filterParams(filters);
      p.set('bbox', box?.bbox ?? '');
      p.set('zoom', String(box?.zoom ?? 13));
      return client.request(`/v1/discover/map?${p.toString()}`, MapResponse, { signal });
    },
    placeholderData: (prev) => prev,
  });
}

export type SearchType = 'all' | 'events' | 'people' | 'venues' | 'crews';

export function useSearch(q: string, type: SearchType) {
  const { client } = useApi();
  const text = q.trim();
  return useQuery({
    queryKey: DISCOVER_KEYS.search(text, type),
    enabled: text.length >= 2,
    queryFn: ({ signal }) =>
      client.request(
        `/v1/discover/search?q=${encodeURIComponent(text)}&type=${type}`,
        SearchResponse,
        { signal },
      ),
    staleTime: 30_000,
  });
}

/** Click logging for ranking quality (F-DSC-07). Fire-and-forget: navigation never waits on it. */
export function useFeedClick() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (input: { requestId: string; eventId: string; position: number }) =>
      client.request('/v1/discover/clicks', Empty, { method: 'POST', body: input }),
  });
}
