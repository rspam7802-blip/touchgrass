import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CityList,
  CityWaitlistStatus,
  type JoinCityWaitlistBody,
  InterestList,
  type LocalizedName,
  NeighbourhoodList,
  type SupportedLanguage,
  VibeTagList,
} from '@touchgrass/shared';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';

const DAY = 24 * 60 * 60 * 1000;

export function useCities() {
  const { client } = useApi();
  return useQuery({
    queryKey: ['cities'],
    queryFn: ({ signal }) => client.request('/v1/cities', CityList, { signal }),
    staleTime: DAY,
  });
}

export function useNeighbourhoods(cityId: string | null) {
  const { client } = useApi();
  return useQuery({
    queryKey: ['neighbourhoods', cityId],
    enabled: cityId !== null,
    queryFn: ({ signal }) =>
      client.request(`/v1/cities/${cityId ?? ''}/neighbourhoods`, NeighbourhoodList, { signal }),
    staleTime: DAY,
  });
}

export function useInterests() {
  const { client } = useApi();
  return useQuery({
    queryKey: ['interests'],
    queryFn: ({ signal }) => client.request('/v1/interests', InterestList, { signal }),
    staleTime: DAY,
  });
}

export function useVibeTags() {
  const { client } = useApi();
  return useQuery({
    queryKey: ['vibe-tags'],
    queryFn: ({ signal }) => client.request('/v1/vibe-tags', VibeTagList, { signal }),
    staleTime: DAY,
  });
}

export function localized(name: LocalizedName, language: string): string {
  return name[(['en', 'te', 'hi'].includes(language) ? language : 'en') as SupportedLanguage];
}

// ---------- city waitlist (F-GRW-03) ----------

const WAITLIST_KEY = ['cities', 'waitlist'] as const;

export function useCityWaitlist() {
  const { client } = useApi();
  return useQuery({
    queryKey: WAITLIST_KEY,
    queryFn: ({ signal }) => client.request('/v1/cities/waitlist', CityWaitlistStatus, { signal }),
  });
}

export function useJoinCityWaitlist() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: JoinCityWaitlistBody) =>
      client.request('/v1/cities/waitlist', CityWaitlistStatus, { method: 'POST', body }),
    onSuccess: (status) => qc.setQueryData(WAITLIST_KEY, status),
  });
}

export function useLeaveCityWaitlist() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => client.request('/v1/cities/waitlist', z.undefined(), { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: WAITLIST_KEY }),
  });
}
