import NetInfo from '@react-native-community/netinfo';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import {
  type ChatClientToServerEvents,
  type ChatServerToClientEvents,
  type EventsClientToServerEvents,
  type EventsServerToClientEvents,
  type IcebreakerCard,
  SOCKET_NAMESPACES,
} from '@touchgrass/shared';
import { useEffect, useMemo } from 'react';
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import { readAppEnvironment } from '../../config';
import { useAuthStore } from '../../stores/auth-store';
import { CHAT_KEYS, upsertMessage } from './api';
import { useOutbox } from './outbox';
import { useChatSender } from './send';

type ChatSocket = Socket<ChatServerToClientEvents, ChatClientToServerEvents>;
type EventsSocket = Socket<EventsServerToClientEvents, EventsClientToServerEvents>;

interface RealtimeState {
  chat: ChatSocket | null;
  events: EventsSocket | null;
  /** conversationId → people currently typing (id → name). */
  typing: Record<string, Record<string, string>>;
  /** Latest card a host pushed to a plan's screens. */
  icebreaker: { eventId: string; card: IcebreakerCard } | null;
  setTyping: (conversationId: string, userId: string, name: string, typing: boolean) => void;
  dismissIcebreaker: () => void;
}

export const useRealtime = create<RealtimeState>((set, get) => ({
  chat: null,
  events: null,
  typing: {},
  icebreaker: null,
  setTyping: (conversationId, userId, name, typing) => {
    const others = Object.entries(get().typing[conversationId] ?? {}).filter(
      ([id]) => id !== userId,
    );
    const current: Record<string, string> = Object.fromEntries(
      typing ? [...others, [userId, name]] : others,
    );
    set({ typing: { ...get().typing, [conversationId]: current } });
  },
  dismissIcebreaker: () => {
    set({ icebreaker: null });
  },
}));

const TYPING_CLEAR_MS = 6000;
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Applies server pushes to the query cache, so screens update without refetch storms. */
export function wireChatSocket(socket: ChatSocket, qc: QueryClient): void {
  socket.on('message:new', (message) => {
    qc.setQueryData(
      CHAT_KEYS.messages(message.conversationId),
      (data: Parameters<typeof upsertMessage>[0]) => upsertMessage(data, message),
    );
    useRealtime.getState().setTyping(message.conversationId, message.sender?.id ?? '', '', false);
    void qc.invalidateQueries({ queryKey: ['chat', 'inbox'] });
  });
  socket.on('message:updated', ({ conversationId }) => {
    void qc.invalidateQueries({ queryKey: CHAT_KEYS.messages(conversationId) });
  });
  socket.on('poll:updated', (poll) => {
    void qc.invalidateQueries({ queryKey: CHAT_KEYS.messages(poll.conversationId) });
  });
  socket.on('conversation:read', ({ conversationId }) => {
    void qc.invalidateQueries({ queryKey: CHAT_KEYS.messages(conversationId) });
    void qc.invalidateQueries({ queryKey: ['chat', 'inbox'] });
  });
  socket.on('conversation:updated', ({ conversationId }) => {
    void qc.invalidateQueries({ queryKey: CHAT_KEYS.conversation(conversationId) });
    void qc.invalidateQueries({ queryKey: CHAT_KEYS.messages(conversationId) });
    void qc.invalidateQueries({ queryKey: ['chat', 'inbox'] });
  });
  socket.on('typing', ({ conversationId, userId, name, typing }) => {
    useRealtime.getState().setTyping(conversationId, userId, name, typing);
    const key = `${conversationId}:${userId}`;
    clearTimeout(typingTimers.get(key));
    if (typing)
      typingTimers.set(
        key,
        setTimeout(() => {
          useRealtime.getState().setTyping(conversationId, userId, name, false);
        }, TYPING_CLEAR_MS),
      );
  });
}

/**
 * Keeps one authenticated socket per namespace while signed in (reconnects when the access token rotates),
 * resends the offline queue when the connection comes back, and refreshes chats after reconnecting.
 */
export function RealtimeConnector() {
  const qc = useQueryClient();
  const token = useAuthStore((s) => s.session?.tokens.accessToken ?? null);
  const realtimeUrl = useMemo(() => readAppEnvironment().realtimeUrl.replace(/\/$/, ''), []);
  const { flush } = useChatSender();

  useEffect(() => {
    void useOutbox.getState().hydrate();
  }, []);

  useEffect(() => {
    if (!token) return;
    const chat: ChatSocket = io(`${realtimeUrl}${SOCKET_NAMESPACES.chat}`, {
      auth: { token },
      transports: ['websocket'],
    });
    const events: EventsSocket = io(`${realtimeUrl}${SOCKET_NAMESPACES.events}`, {
      auth: { token },
      transports: ['websocket'],
    });
    wireChatSocket(chat, qc);
    chat.on('connect', () => {
      void qc.invalidateQueries({ queryKey: CHAT_KEYS.all });
      void flush();
    });
    events.on('icebreaker:show', (payload) => {
      useRealtime.setState({ icebreaker: payload });
    });
    useRealtime.setState({ chat, events });
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) void flush();
    });
    return () => {
      unsubscribe();
      chat.disconnect();
      events.disconnect();
      useRealtime.setState({ chat: null, events: null });
    };
  }, [token, realtimeUrl, qc, flush]);

  return null;
}
