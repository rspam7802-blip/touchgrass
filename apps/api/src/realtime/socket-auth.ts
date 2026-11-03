import type { Namespace } from 'socket.io';
import { RedisIoAdapter } from './redis-io.adapter.js';

/** Installs JWT auth middleware on a namespace. Unauthenticated sockets never reach a handler. */
export function installAuth(nsp: Namespace, secret: string): void {
  nsp.use((socket, next) => {
    const data = RedisIoAdapter.authenticate(
      (socket.handshake.auth as Record<string, unknown>).token,
      secret,
    );
    if (!data) {
      next(new Error('UNAUTHENTICATED'));
      return;
    }
    Object.assign(socket.data as object, data);
    next();
  });
}
