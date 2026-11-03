import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type FeedbackBody,
  FeedbackSummary,
  LoreAlbum,
  LoreDownload,
  type LoreVisibility,
  MyFeedback,
  PendingPostEvent,
  PostEventCard,
  PullResult,
  ReconnectList,
} from '@touchgrass/shared';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';
import { EVENT_KEYS } from '../events/api';

const Empty = z.undefined();

export const AFTER_KEYS = {
  pending: ['after', 'pending'] as const,
  card: (eventId: string) => ['after', 'card', eventId] as const,
  people: (eventId: string) => ['after', 'people', eventId] as const,
  summary: (eventId: string) => ['after', 'summary', eventId] as const,
  lore: (eventId: string) => ['lore', eventId] as const,
};

export function usePendingPostEvent(enabled: boolean) {
  const { client } = useApi();
  return useQuery({
    queryKey: AFTER_KEYS.pending,
    enabled,
    queryFn: ({ signal }) => client.request('/v1/me/after', PendingPostEvent, { signal }),
  });
}

export function usePostEventCard(eventId: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: AFTER_KEYS.card(eventId),
    queryFn: ({ signal }) =>
      client.request(`/v1/events/${eventId}/after`, PostEventCard, { signal }),
  });
}

export function useSubmitFeedback(eventId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: FeedbackBody) =>
      client.request(`/v1/events/${eventId}/feedback`, MyFeedback, { method: 'PUT', body }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: AFTER_KEYS.card(eventId) });
    },
  });
}

export function useDismissPostEvent(eventId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      client.request(`/v1/events/${eventId}/after/dismiss`, Empty, { method: 'POST' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: AFTER_KEYS.pending });
    },
  });
}

export function usePeopleYouMet(eventId: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: AFTER_KEYS.people(eventId),
    queryFn: ({ signal }) =>
      client.request(`/v1/events/${eventId}/people`, ReconnectList, { signal }),
  });
}

export function usePull(eventId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      client.request(`/v1/events/${eventId}/people/${userId}/pull`, PullResult, { method: 'POST' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: AFTER_KEYS.people(eventId) }),
        qc.invalidateQueries({ queryKey: AFTER_KEYS.card(eventId) }),
        qc.invalidateQueries({ queryKey: ['social'] }),
      ]);
    },
  });
}

export function useFeedbackSummary(eventId: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: AFTER_KEYS.summary(eventId),
    queryFn: ({ signal }) =>
      client.request(`/v1/events/${eventId}/feedback/summary`, FeedbackSummary, { signal }),
  });
}

// ---------- Lore (F-AFT-04) ----------

export function useLore(eventId: string) {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: AFTER_KEYS.lore(eventId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/events/${eventId}/lore?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        LoreAlbum,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

function useLoreMutation<TIn, TOut>(eventId: string, fn: (input: TIn) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: AFTER_KEYS.lore(eventId) }),
        qc.invalidateQueries({ queryKey: EVENT_KEYS.detail(eventId) }),
      ]);
    },
  });
}

export function useAddLore(eventId: string) {
  const { client } = useApi();
  return useLoreMutation(eventId, (input: { mediaId: string; caption: string }) =>
    client.request(`/v1/events/${eventId}/lore`, z.object({ id: z.uuid() }), {
      method: 'POST',
      body: input,
    }),
  );
}

export function useRemoveLore(eventId: string) {
  const { client } = useApi();
  return useLoreMutation(eventId, (itemId: string) =>
    client.request(`/v1/lore/${itemId}`, Empty, { method: 'DELETE' }),
  );
}

export function useLoreVisibility(eventId: string) {
  const { client } = useApi();
  return useLoreMutation(eventId, (visibility: LoreVisibility) =>
    client.request(`/v1/events/${eventId}/lore/visibility`, Empty, {
      method: 'PUT',
      body: { visibility },
    }),
  );
}

export function useLoreDownload(eventId: string) {
  const { client } = useApi();
  return useMutation({
    mutationFn: () => client.request(`/v1/events/${eventId}/lore/download`, LoreDownload),
  });
}
