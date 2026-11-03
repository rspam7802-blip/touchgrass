import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRole } from '@touchgrass/shared';
import { AppError } from '../errors/app-error.js';
import type { AppRequest } from '../http/request-context.js';
import { REQUIRED_ROLES } from './decorators.js';

/** super_admin implicitly holds every role. */
export function hasAnyRole(held: readonly string[], required: readonly AdminRole[]): boolean {
  if (required.length === 0) return true;
  if (held.includes('super_admin')) return true;
  return required.some((r) => held.includes(r));
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;
    const required = this.reflector.getAllAndOverride<AdminRole[] | undefined>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.principal) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    if (!hasAnyRole(req.principal.roles, required))
      throw new AppError('FORBIDDEN', 'Insufficient role');
    return true;
  }
}
