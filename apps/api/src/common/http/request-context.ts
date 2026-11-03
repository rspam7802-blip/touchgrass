import type { Request } from 'express';

/** The authenticated principal attached to a request by the auth guard (Phase 1). */
export interface AuthPrincipal {
  userId: string;
  sessionId: string;
  roles: readonly string[];
}

export interface AppRequest extends Request {
  principal?: AuthPrincipal;
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? 'unknown';
}
