import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { EventComment, EventCommentPage } from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';

const Empty = z.undefined();
export const commentsKey = (eventId: string) => ['events', eventId, 'comments'] as const;

/** Comments on a plan, newest first (D-156). */
export function useEventComments(eventId: string) {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: commentsKey(eventId),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/events/${eventId}/comments?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        EventCommentPage,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function usePostComment(eventId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      client.request(`/v1/events/${eventId}/comments`, EventComment, {
        method: 'POST',
        body: { body },
        idempotencyKey: `comment-${Crypto.randomUUID()}`,
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: commentsKey(eventId) });
    },
  });
}

export function useDeleteComment(eventId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      client.request(`/v1/comments/${commentId}`, Empty, { method: 'DELETE' }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: commentsKey(eventId) });
    },
  });
}
