import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AdminRole } from '@touchgrass/shared';
import { AppError } from '../errors/app-error.js';
import type { AppRequest, AuthPrincipal } from '../http/request-context.js';

export const IS_PUBLIC = 'tg:public';
/** Route needs no access token (OTP, refresh, health, public catalog). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_ROLES = 'tg:roles';
/** Route requires at least one of these admin roles (checked by RolesGuard after AuthGuard). */
export const Roles = (...roles: AdminRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);

export const ALLOW_INCOMPLETE = 'tg:allow-incomplete-onboarding';
/** Route is usable before onboarding is complete (profile setup endpoints). */
export const AllowOnboarding = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_INCOMPLETE, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.principal) throw new AppError('UNAUTHENTICATED', 'Authentication required');
    return req.principal;
  },
);
