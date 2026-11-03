import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import type { Server as HttpServer } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signAccessToken } from '../src/common/auth/jwt.js';
import { createRealtimeApp } from '../src/realtime/bootstrap-realtime.js';
import { ChatGateway } from '../src/realtime/chat.gateway.js';
import { integrationEnv } from './helpers.js';

const env = integrationEnv();
const token = (): string =>
  signAccessToken({ sub: uuidv7(), sid: uuidv7() }, env.JWT_ACCESS_SECRET, 900);

function connect(port: number, auth: Record<string, unknown>): Socket {
  return io(`http://127.0.0.1:${port}/chat`, {
    auth,
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
  });
}

function once<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve) =>
    socket.once(event, (payload: T) => {
      resolve(payload);
    }),
  );
}

describe('realtime gateway (Socket.IO + Redis adapter, two instances)', () => {
  let a: INestApplication;
  let b: INestApplication;
  let portA: number;
  let portB: number;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    a = await createRealtimeApp(env, { logger: false });
    b = await createRealtimeApp(env, { logger: false });
    await a.listen(0, '127.0.0.1');
    await b.listen(0, '127.0.0.1');
    portA = ((a.getHttpServer() as HttpServer).address() as AddressInfo).port;
    portB = ((b.getHttpServer() as HttpServer).address() as AddressInfo).port;
  });
  afterAll(async () => {
    for (const s of sockets) s.disconnect();
    await a.close();
    await b.close();
  });

  it('rejects connections without a valid JWT', async () => {
    const anon = connect(portA, {});
    sockets.push(anon);
    const err = await once<Error>(anon, 'connect_error');
    expect(err.message).toBe('UNAUTHENTICATED');
    const forged = connect(portA, {
      token: signAccessToken({ sub: uuidv7(), sid: uuidv7() }, 'x'.repeat(40), 900),
    });
    sockets.push(forged);
    expect((await once<Error>(forged, 'connect_error')).message).toBe('UNAUTHENTICATED');
  });

  it('accepts authenticated clients and answers pings with an ack', async () => {
    const s = connect(portA, { token: token() });
    sockets.push(s);
    await once(s, 'connect');
    const ack = await s.emitWithAck('system:ping');
    expect(ack).toMatchObject({ ok: true, data: { serverTime: expect.any(String) as string } });
  });

  it('fans out broadcasts across instances through Redis', async () => {
    const onB = connect(portB, { token: token() });
    sockets.push(onB);
    await once(onB, 'connect');
    const received = once<{ code: string }>(onB, 'system:error');
    // Emit from instance A's namespace server; the client is connected to instance B.
    await new Promise((r) => setTimeout(r, 200));
    a.get(ChatGateway).nsp.emit('system:error', { code: 'PROBE', message: 'hello from A' });
    expect(await received).toEqual({ code: 'PROBE', message: 'hello from A' });
  });
});
