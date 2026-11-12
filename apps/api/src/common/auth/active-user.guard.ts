import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../modules/users/users.service.js';
import { AppError } from '../errors/app-error.js';
import type { AppRequest } from '../http/request-context.js';
import type { AdminRole } from '@touchgrass/shared';
import { ALLOW_INCOMPLETE, IS_PUBLIC, REQUIRED_ROLES } from './decorators.js';
import { hasAnyRole } from './roles.guard.js';

/**
 * Users who have not finished onboarding may only call routes marked @AllowOnboarding(), public routes, and
 * (for staff) the admin routes their role allows: running the admin console doesn't need a member profile.
 * Status is cached for 60 s and invalidated whenever it changes.
 */
@Injectable()
export class ActiveUserGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.principal) return true;
    const status = await this.users.statusOf(req.principal.userId);
    if (status === null || status === 'deleted' || status === 'deletion_pending')
      throw new AppError('SESSION_REVOKED', 'Account is not active');
    if (status === 'suspended' || status === 'banned')
      throw new AppError('ACCOUNT_SUSPENDED', 'Account suspended');
    if (status === 'age_blocked')
      throw new AppError('AGE_RESTRICTED', 'TouchGrass is for people 18 and over');
    const targets = [context.getHandler(), context.getClass()];
    // Public routes are open to anyone anyway; a half-finished sign-up still on the phone must not stop
    // the person requesting or verifying a code (signing in again, or with another number).
    const allowIncomplete =
      this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_INCOMPLETE, targets) === true ||
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, targets) === true ||
      isStaffRoute(
        this.reflector.getAllAndOverride<AdminRole[] | undefined>(REQUIRED_ROLES, targets),
        req.principal.roles,
      );
    if (status === 'onboarding' && !allowIncomplete)
      throw new AppError('ONBOARDING_INCOMPLETE', 'Finish onboarding first');
    return true;
  }
}

/** An admin route (one with @Roles) called by someone holding one of its roles; RolesGuard still enforces them. */
export function isStaffRoute(
  required: readonly AdminRole[] | undefined,
  held: readonly string[],
): boolean {
  return required !== undefined && required.length > 0 && hasAnyRole(held, required);
}
