import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  ConversationList,
  ConversationSummary,
  type CreatePollBody,
  EventSignal,
  IcebreakerCard,
  IcebreakerDeck,
  Message,
  MessagePage,
  type MuteBody,
  NewcomerList,
  PollView,
  type Reaction,
} from '@touchgrass/shared';
import { z } from 'zod';
import { useApi } from '../../providers/api-context';

const Empty = z.undefined();

export const CHAT_KEYS = {
  all: ['chat'] as const,
  inbox: (filter: 'all' | 'requests') => ['chat', 'inbox', filter] as const,
  conversation: (id: string) => ['chat', 'conversation', id] as const,
  messages: (id: string) => ['chat', 'messages', id] as const,
  deck: (eventId: string) => ['at-event', 'deck', eventId] as const,
  signal: (eventId: string) => ['at-event', 'signal', eventId] as const,
  newcomers: (eventId: string) => ['at-event', 'newcomers', eventId] as const,
};

export function useInbox(filter: 'all' | 'requests') {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: CHAT_KEYS.inbox(filter),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/chats?filter=${filter}&limit=30${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        ConversationList,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useConversation(id: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: CHAT_KEYS.conversation(id),
    queryFn: ({ signal }) => client.request(`/v1/chats/${id}`, ConversationSummary, { signal }),
  });
}

/** Newest first; later pages are older messages. */
export function useMessages(id: string) {
  const { client } = useApi();
  return useInfiniteQuery({
    queryKey: CHAT_KEYS.messages(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      client.request(
        `/v1/chats/${id}/messages?limit=40${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
        MessagePage,
        { signal },
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/** Adds (or replaces by id) a message at the top of a cached thread. */
export function upsertMessage(
  data: InfiniteData<MessagePage> | undefined,
  message: Message,
): InfiniteData<MessagePage> | undefined {
  if (!data) return data;
  const exists = data.pages.some((p) => p.items.some((m) => m.id === message.id));
  if (exists)
    return {
      ...data,
      pages: data.pages.map((p) => ({
        ...p,
        items: p.items.map((m) => (m.id === message.id ? message : m)),
      })),
    };
  const [first, ...rest] = data.pages;
  if (!first) return data;
  return { ...data, pages: [{ ...first, items: [message, ...first.items] }, ...rest] };
}

export function useStartDirect() {
  const { client } = useApi();
  return useMutation({
    mutationFn: (userId: string) =>
      client.request('/v1/chats/direct', ConversationSummary, { method: 'POST', body: { userId } }),
  });
}

export function useEventChat(eventId: string, enabled = true) {
  const { client } = useApi();
  return useQuery({
    queryKey: ['chat', 'event', eventId],
    enabled,
    queryFn: ({ signal }) =>
      client.request(`/v1/events/${eventId}/chat`, ConversationSummary, { signal }),
  });
}

/** Any chat change refreshes the inbox and that thread. */
function useChatMutation<TInput, TOut>(
  conversationId: string,
  fn: (input: TInput) => Promise<TOut>,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: CHAT_KEYS.messages(conversationId) }),
        qc.invalidateQueries({ queryKey: CHAT_KEYS.conversation(conversationId) }),
        qc.invalidateQueries({ queryKey: ['chat', 'inbox'] }),
      ]);
    },
  });
}

export function useRespondRequest(conversationId: string) {
  const { client } = useApi();
  return useChatMutation(conversationId, (accept: boolean) =>
    client.request(`/v1/chats/${conversationId}/request`, ConversationSummary.optional(), {
      method: 'POST',
      body: { accept },
    }),
  );
}

export function useMute(conversationId: string) {
  const { client } = useApi();
  return useChatMutation(conversationId, (duration: MuteBody['duration']) =>
    client.request(`/v1/chats/${conversationId}/mute`, ConversationSummary, {
      method: 'PUT',
      body: { duration },
    }),
  );
}

export function useReact(conversationId: string) {
  const { client } = useApi();
  return useChatMutation(
    conversationId,
    (input: { messageId: string; emoji: Reaction; add: boolean }) =>
      input.add
        ? client.request(
            `/v1/chats/${conversationId}/messages/${input.messageId}/reactions`,
            Message,
            { method: 'POST', body: { emoji: input.emoji } },
          )
        : client.request(
            `/v1/chats/${conversationId}/messages/${input.messageId}/reactions?emoji=${encodeURIComponent(input.emoji)}`,
            Message,
            { method: 'DELETE' },
          ),
  );
}

export function useDeleteMessage(conversationId: string) {
  const { client } = useApi();
  return useChatMutation(conversationId, (input: { messageId: string; scope: 'me' | 'everyone' }) =>
    client.request(
      `/v1/chats/${conversationId}/messages/${input.messageId}?scope=${input.scope}`,
      Empty,
      { method: 'DELETE' },
    ),
  );
}

export function useMarkRead(conversationId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      client.request(`/v1/chats/${conversationId}/read`, Empty, {
        method: 'POST',
        body: { messageId },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat', 'inbox'] }),
  });
}

export function useCreatePoll(conversationId: string) {
  const { client } = useApi();
  return useChatMutation(conversationId, (body: CreatePollBody) =>
    client.request(`/v1/chats/${conversationId}/polls`, Message, { method: 'POST', body }),
  );
}

export function useVote(conversationId: string) {
  const { client } = useApi();
  return useChatMutation(conversationId, (input: { pollId: string; optionIds: string[] }) =>
    client.request(`/v1/polls/${input.pollId}/votes`, PollView, {
      method: 'POST',
      body: { optionIds: input.optionIds },
    }),
  );
}

export function useClosePoll(conversationId: string) {
  const { client } = useApi();
  return useChatMutation(conversationId, (pollId: string) =>
    client.request(`/v1/polls/${pollId}/close`, PollView, { method: 'POST' }),
  );
}

// ---------- at the event (F-ATE-01..03) ----------

export function useDeck(eventId: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: CHAT_KEYS.deck(eventId),
    queryFn: ({ signal }) =>
      client.request(`/v1/events/${eventId}/icebreakers`, IcebreakerDeck, { signal }),
    staleTime: 10 * 60_000,
  });
}

export function usePushIcebreaker(eventId: string) {
  const { client } = useApi();
  return useMutation({
    mutationFn: (cardId: string) =>
      client.request(`/v1/events/${eventId}/icebreakers/push`, IcebreakerCard, {
        method: 'POST',
        body: { cardId },
      }),
  });
}

export function useSignal(eventId: string, enabled: boolean) {
  const { client } = useApi();
  return useQuery({
    queryKey: CHAT_KEYS.signal(eventId),
    enabled,
    queryFn: ({ signal }) =>
      client.request(`/v1/events/${eventId}/signal`, EventSignal, { signal }),
    staleTime: Infinity,
  });
}

export function useNewcomers(eventId: string) {
  const { client } = useApi();
  return useQuery({
    queryKey: CHAT_KEYS.newcomers(eventId),
    queryFn: ({ signal }) =>
      client.request(`/v1/events/${eventId}/newcomers`, NewcomerList, { signal }),
  });
}

export function useWelcome(eventId: string) {
  const { client } = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { userId: string; welcomed: boolean }) =>
      client.request(`/v1/events/${eventId}/newcomers/${input.userId}`, NewcomerList, {
        method: 'PUT',
        body: { welcomed: input.welcomed },
      }),
    onSuccess: (data) => {
      qc.setQueryData(CHAT_KEYS.newcomers(eventId), data);
    },
  });
}
