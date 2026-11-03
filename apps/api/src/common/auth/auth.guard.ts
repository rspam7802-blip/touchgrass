import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { AppError } from '../errors/app-error.js';
import type { AppRequest } from '../http/request-context.js';
import { IS_PUBLIC } from './decorators.js';
import { verifyAccessToken } from './jwt.js';
import { SessionRevocationService } from './revocation.service.js';

/** Global guard: every route needs a valid, unrevoked access token unless marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly revocations: SessionRevocationService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      if (isPublic) return true;
      throw new AppError('UNAUTHENTICATED', 'Authentication required');
    }
    const result = verifyAccessToken(token, this.env.JWT_ACCESS_SECRET);
    if (!result.ok) {
      if (isPublic) return true;
      throw new AppError(
        result.error === 'expired' ? 'TOKEN_EXPIRED' : 'UNAUTHENTICATED',
        'Invalid access token',
      );
    }
    if (await this.revocations.isRevoked(result.claims.sid)) {
      if (isPublic) return true;
      throw new AppError('SESSION_REVOKED', 'Session was revoked');
    }
    req.principal = {
      userId: result.claims.sub,
      sessionId: result.claims.sid,
      roles: result.claims.roles,
    };
    return true;
  }
}
