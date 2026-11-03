import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ROOMS, SOCKET_NAMESPACES, type SocketAck } from '@touchgrass/shared';
import type { Namespace, Socket } from 'socket.io';
import { z } from 'zod';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { ChatPresence } from '../modules/chat/chat-presence.js';
import { ChatService } from '../modules/chat/chat.service.js';
import { ProfilesService } from '../modules/profiles/profiles.service.js';
import type { SocketData } from './redis-io.adapter.js';
import { installAuth } from './socket-auth.js';

const JoinPayload = z.object({ conversationId: z.uuid() });
const TypingPayload = z.object({ conversationId: z.uuid(), typing: z.boolean() });

/**
 * /chat namespace (F-CHT-04). Every socket joins its own `user:<id>` room on connect; message fan-out from the
 * API/worker targets those rooms. `chat:join` (after a membership check) marks the person as looking at a
 * conversation — which suppresses pushes — and enables typing indicators, which go only to members the
 * typist is not blocked with.
 */
@WebSocketGateway({ namespace: SOCKET_NAMESPACES.chat })
export class ChatGateway
  implements OnGatewayInit<Namespace>, OnGatewayConnection<Socket>, OnGatewayDisconnect<Socket>
{
  private readonly logger = new Logger(ChatGateway.name);
  @WebSocketServer() readonly nsp!: Namespace;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly chat: ChatService,
    private readonly presence: ChatPresence,
    private readonly profiles: ProfilesService,
  ) {}

  afterInit(nsp: Namespace): void {
    installAuth(nsp, this.env.JWT_ACCESS_SECRET);
    this.logger.log(`namespace ${SOCKET_NAMESPACES.chat} ready`);
  }

  private static data(socket: Socket): SocketData & { open?: Set<string> } {
    return socket.data as SocketData & { open?: Set<string> };
  }

  async handleConnection(socket: Socket): Promise<void> {
    await socket.join(ROOMS.user(ChatGateway.data(socket).userId));
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    const d = ChatGateway.data(socket);
    for (const conversationId of d.open ?? []) await this.presence.leave(conversationId, d.userId);
  }

  @SubscribeMessage('system:ping')
  ping(): SocketAck<{ serverTime: string }> {
    return { ok: true, data: { serverTime: new Date().toISOString() } };
  }

  /** Re-sent periodically by clients while a chat is on screen (refreshes presence). */
  @SubscribeMessage('chat:join')
  async join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<SocketAck<{ joined: true }>> {
    const parsed = JoinPayload.safeParse(body);
    if (!parsed.success)
      return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'Bad payload' } };
    const d = ChatGateway.data(socket);
    if (!(await this.chat.canJoin(d.userId, parsed.data.conversationId)))
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Conversation not found' } };
    d.open = new Set([...(d.open ?? []), parsed.data.conversationId]);
    await this.presence.enter(parsed.data.conversationId, d.userId);
    return { ok: true, data: { joined: true } };
  }

  @SubscribeMessage('chat:leave')
  async leave(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    const parsed = JoinPayload.safeParse(body);
    if (!parsed.success) return;
    const d = ChatGateway.data(socket);
    d.open?.delete(parsed.data.conversationId);
    await this.presence.leave(parsed.data.conversationId, d.userId);
  }

  @SubscribeMessage('chat:typing')
  async typing(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown): Promise<void> {
    const parsed = TypingPayload.safeParse(body);
    if (!parsed.success) return;
    const d = ChatGateway.data(socket);
    // Only for chats this socket joined (membership already checked).
    if (!d.open?.has(parsed.data.conversationId)) return;
    const conv = await this.chat.conversationRow(parsed.data.conversationId);
    if (!conv) return;
    const to = (await this.chat.recipients(conv, d.userId))
      .filter((id) => id !== d.userId)
      .map(ROOMS.user);
    if (to.length === 0) return;
    const name = (await this.profiles.displayNames([d.userId])).get(d.userId) ?? '';
    this.nsp.to(to).emit('typing', {
      conversationId: conv.id,
      userId: d.userId,
      name,
      typing: parsed.data.typing,
    });
  }
}
