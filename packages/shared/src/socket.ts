import type { Message, PollView, IcebreakerCard } from './schemas/chat';

/**
 * Typed Socket.IO contracts shared by the realtime gateway and clients.
 * Namespaces: /chat and /events. Rooms are joined only after a server-side membership check.
 */
export const SOCKET_NAMESPACES = { chat: '/chat', events: '/events' } as const;

export interface SocketErrorPayload {
  code: string;
  message: string;
}

export interface SocketAck<T> {
  ok: boolean;
  data?: T;
  error?: SocketErrorPayload;
}

export interface BaseServerToClientEvents {
  'system:error': (payload: SocketErrorPayload) => void;
}

export interface BaseClientToServerEvents {
  'system:ping': (ack: (res: SocketAck<{ serverTime: string }>) => void) => void;
}

/** Room names; the server joins sockets only after a membership check. */
export const ROOMS = {
  user: (userId: string) => `user:${userId}`,
  conversation: (conversationId: string) => `conv:${conversationId}`,
  event: (eventId: string) => `event:${eventId}`,
} as const;

/** Chat namespace (F-CHT-01..05). Every action also has a REST endpoint; sockets only carry fan-out. */
export interface ChatServerToClientEvents extends BaseServerToClientEvents {
  'message:new': (message: Message) => void;
  /** Deleted, reacted to, or a poll in it changed. Clients refetch or patch by id. */
  'message:updated': (payload: { conversationId: string; messageId: string }) => void;
  'conversation:read': (payload: {
    conversationId: string;
    userId: string;
    messageId: string;
  }) => void;
  'conversation:updated': (payload: { conversationId: string }) => void;
  typing: (payload: {
    conversationId: string;
    userId: string;
    name: string;
    typing: boolean;
  }) => void;
  'poll:updated': (poll: PollView) => void;
}
export interface ChatClientToServerEvents extends BaseClientToServerEvents {
  'chat:join': (
    payload: { conversationId: string },
    ack: (res: SocketAck<{ joined: true }>) => void,
  ) => void;
  'chat:leave': (payload: { conversationId: string }) => void;
  'chat:typing': (payload: { conversationId: string; typing: boolean }) => void;
}

/** Events namespace (F-ATE-01): hosts push an icebreaker to every attendee's screen. */
export interface EventsServerToClientEvents extends BaseServerToClientEvents {
  'icebreaker:show': (payload: { eventId: string; card: IcebreakerCard }) => void;
}
export interface EventsClientToServerEvents extends BaseClientToServerEvents {
  'event:join': (
    payload: { eventId: string },
    ack: (res: SocketAck<{ joined: true }>) => void,
  ) => void;
}
