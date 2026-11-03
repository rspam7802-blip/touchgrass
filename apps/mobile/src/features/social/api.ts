import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ActivityFeed,
  BlockedList,
  ContactMatchResponse,
  type CreateReportBody,
  FriendRequestList,
  FriendRequestResult,
  PersonList,
  ReportCreated,
  SuggestionList,
} from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';

const Empty = z.undefined();
export const SOCIAL_KEYS = {
  squad: ['social', 'squad'] as const,
  requests: ['social', 'requests'] as const,
  suggestions: ['social', 'suggestions'] as const,
  activity: ['social', 'activity'] as const,
  blocks: ['social', 'blocks'] as const,
};

export function useSquad() {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: SOCIAL_KEYS.squad,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/social/squad?limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        PersonList,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useActivity() {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: SOCIAL_KEYS.activity,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/activity?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        ActivityFeed,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useRequests() {
  const { client } = useApi();
  return useQuery({
    queryKey: SOCIAL_KEYS.requests,
    queryFn: ({ signal }) => client.request('/v1/social/requests', FriendRequestList, { signal }),
  });
}

export function useSuggestions() {
  const { client } = useApi();
  return useQuery({
    queryKey: SOCIAL_KEYS.suggestions,
    queryFn: ({ signal }) => client.request('/v1/social/suggestions', SuggestionList, { signal }),
  });
}

export function useBlocked() {
  const { client } = useApi();
  return useQuery({
    queryKey: SOCIAL_KEYS.blocks,
    queryFn: ({ signal }) => client.request('/v1/social/blocks', BlockedList, { signal }),
  });
}

/** Every squad action changes lists, suggestions and the person's profile, so refresh them all. */
function useSocialMutation<TInput, TOut>(fn: (input: TInput) => Promise<TOut>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['social'] }),
        qc.invalidateQueries({ queryKey: ['profile'] }),
      ]);
    },
  });
}

export type SquadAction =
  'request' | 'accept' | 'decline' | 'cancel' | 'remove' | 'dismiss' | 'block' | 'unblock';

export function useSquadAction() {
  const { client } = useApi();
  return useSocialMutation(async ({ action, userId }: { action: SquadAction; userId: string }) => {
    switch (action) {
      case 'request':
        return client.request('/v1/social/requests', FriendRequestResult, {
          method: 'POST',
          body: { userId },
          idempotencyKey: `req-${Crypto.randomUUID()}`,
        });
      case 'accept':
        return client.request(`/v1/social/requests/${userId}/accept`, FriendRequestResult, {
          method: 'POST',
        });
      case 'decline':
        return client.request(`/v1/social/requests/${userId}/decline`, FriendRequestResult, {
          method: 'POST',
        });
      case 'cancel':
        return client.request(`/v1/social/requests/${userId}`, Empty, { method: 'DELETE' });
      case 'remove':
        return client.request(`/v1/social/squad/${userId}`, Empty, { method: 'DELETE' });
      case 'dismiss':
        return client.request(`/v1/social/suggestions/${userId}/dismiss`, Empty, {
          method: 'POST',
        });
      case 'block':
        return client.request('/v1/social/blocks', Empty, { method: 'POST', body: { userId } });
      case 'unblock':
        return client.request(`/v1/social/blocks/${userId}`, Empty, { method: 'DELETE' });
    }
  });
}

export function useMatchContacts() {
  const { client } = useApi();
  return useSocialMutation((hashes: string[]) =>
    client.request('/v1/social/contacts/match', ContactMatchResponse, {
      method: 'POST',
      body: { hashes },
    }),
  );
}

export function useCreateReport() {
  const { client } = useApi();
  return useSocialMutation(
    (
      body: Partial<CreateReportBody> &
        Pick<CreateReportBody, 'targetType' | 'targetId' | 'category'>,
    ) =>
      client.request('/v1/reports', ReportCreated, {
        method: 'POST',
        body,
        idempotencyKey: `report-${Crypto.randomUUID()}`,
      }),
  );
}

export function flatten<T>(data: InfiniteData<{ items: T[] }> | undefined): T[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}
