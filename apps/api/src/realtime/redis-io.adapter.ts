import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { verifyAccessToken } from '../common/auth/jwt.js';

export interface SocketData {
  userId: string;
  sessionId: string;
}

/**
 * Socket.IO with the Redis adapter so events fan out across realtime instances.
 * Every namespace authenticates on connect with the access JWT (handshake `auth.token`).
 */
export class RedisIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly pub: Redis,
    private readonly sub: Redis,
    private readonly corsOrigins: string[],
  ) {
    super(app);
  }

  override createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    const merged: Partial<ServerOptions> = {
      ...options,
      cors: { origin: this.corsOrigins },
      transports: ['websocket', 'polling'],
      pingInterval: 20_000,
      pingTimeout: 20_000,
    };
    const server: Server = super.createIOServer(port, merged as ServerOptions);
    server.adapter(createAdapter(this.pub, this.sub));
    return server;
  }

  static authenticate(token: unknown, secret: string): SocketData | null {
    if (typeof token !== 'string') return null;
    const result = verifyAccessToken(token, secret);
    return result.ok ? { userId: result.claims.sub, sessionId: result.claims.sid } : null;
  }
}
