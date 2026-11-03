import { Inject } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
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
import { EventChatGate } from '../modules/chat/conversation-gates.js';
import type { SocketData } from './redis-io.adapter.js';
import { installAuth } from './socket-auth.js';

const JoinPayload = z.object({ eventId: z.uuid() });

/** /events namespace (F-ATE-01): people at a plan join its room to receive host-pushed icebreakers. */
@WebSocketGateway({ namespace: SOCKET_NAMESPACES.events })
export class EventsGateway implements OnGatewayInit<Namespace> {
  @WebSocketServer() readonly nsp!: Namespace;

  constructor(
    @Inject(ENV) private readonly env: Env,
    private readonly gate: EventChatGate,
  ) {}

  afterInit(nsp: Namespace): void {
    installAuth(nsp, this.env.JWT_ACCESS_SECRET);
  }

  @SubscribeMessage('system:ping')
  ping(): SocketAck<{ serverTime: string }> {
    return { ok: true, data: { serverTime: new Date().toISOString() } };
  }

  @SubscribeMessage('event:join')
  async join(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ): Promise<SocketAck<{ joined: true }>> {
    const parsed = JoinPayload.safeParse(body);
    if (!parsed.success)
      return { ok: false, error: { code: 'VALIDATION_FAILED', message: 'Bad payload' } };
    const { userId } = socket.data as SocketData;
    if (!(await this.gate.access(userId, parsed.data.eventId, new Date())).read)
      return { ok: false, error: { code: 'NOT_FOUND', message: 'Event not found' } };
    await socket.join(ROOMS.event(parsed.data.eventId));
    return { ok: true, data: { joined: true } };
  }
}
