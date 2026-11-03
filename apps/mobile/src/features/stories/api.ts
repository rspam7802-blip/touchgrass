import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PersonStories, type PostStoryBody, StoryTray, StoryViewersPage } from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';

const Empty = z.undefined();

export const STORY_KEYS = {
  tray: ['stories', 'tray'] as const,
  person: (userId: string) => ['stories', 'person', userId] as const,
  viewers: (storyId: string) => ['stories', 'viewers', storyId] as const,
};

/** People with stories you can see (Phase 13). */
export function useStoryTray(enabled = true) {
  const { client } = useApi();
  return useQuery({
    queryKey: STORY_KEYS.tray,
    enabled,
    queryFn: ({ signal }) => client.request('/v1/stories', StoryTray, { signal }),
  });
}

export function usePersonStories(userId: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: STORY_KEYS.person(userId),
    queryFn: ({ signal }) =>
      client.request(`/v1/users/${userId}/stories`, PersonStories, { signal }),
  });
}

export function usePostStory() {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PostStoryBody) =>
      client.request('/v1/stories', z.object({ id: z.uuid() }), {
        method: 'POST',
        body,
        idempotencyKey: `story-${Crypto.randomUUID()}`,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['stories'] });
    },
  });
}

/** Marks a story seen; the tray refreshes when the viewer closes. */
export function useMarkStoryViewed() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (storyId: string) =>
      client.request(`/v1/stories/${storyId}/view`, Empty, { method: 'POST' }),
  });
}

export function useLikeStory(authorId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ storyId, liked }: { storyId: string; liked: boolean }) =>
      client.request(`/v1/stories/${storyId}/like`, Empty, { method: liked ? 'PUT' : 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: STORY_KEYS.person(authorId) });
    },
  });
}

export function useDeleteStory(authorId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (storyId: string) =>
      client.request(`/v1/stories/${storyId}`, Empty, { method: 'DELETE' }),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: STORY_KEYS.person(authorId) }),
        qc.invalidateQueries({ queryKey: STORY_KEYS.tray }),
      ]);
    },
  });
}

/** Author only: who opened a story. */
export function useStoryViewers(storyId: string | null) {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: STORY_KEYS.viewers(storyId ?? ''),
    enabled: storyId !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/stories/${storyId ?? ''}/viewers?limit=50${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        StoryViewersPage,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
