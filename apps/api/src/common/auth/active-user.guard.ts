import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UsersService } from '../../modules/users/users.service.js';
import { AppError } from '../errors/app-error.js';
import type { AppRequest } from '../http/request-context.js';
import { ALLOW_INCOMPLETE } from './decorators.js';

/**
 * Users who have not finished onboarding may only call routes marked @AllowOnboarding().
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
    const allowIncomplete = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_INCOMPLETE,
      [context.getHandler(), context.getClass()],
    );
    if (status === 'onboarding' && !allowIncomplete)
      throw new AppError('ONBOARDING_INCOMPLETE', 'Finish onboarding first');
    return true;
  }
}
