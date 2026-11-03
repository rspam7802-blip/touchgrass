import { Global, Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { UsersModule } from '../modules/users/users.module.js';
import { ActiveUserGuard } from './auth/active-user.guard.js';
import { AdminScopeService } from './auth/admin-scope.js';
import { AuthGuard } from './auth/auth.guard.js';
import { SessionRevocationService } from './auth/revocation.service.js';
import { RolesGuard } from './auth/roles.guard.js';
import { AuditService } from './audit/audit.service.js';
import { AuditTrailInterceptor } from './audit/audit-trail.interceptor.js';
import { IdempotencyInterceptor } from './idempotency/idempotency.js';
import { RateLimitGuard } from './rate-limit/rate-limit.guard.js';
import { RateLimitService } from './rate-limit/rate-limit.service.js';

/**
 * Cross-cutting HTTP concerns applied to every route, in this order:
 * authenticate → active/onboarding status → roles → rate limit (per user once authenticated) → idempotency
 * → audit trail (admin writes).
 */
@Global()
@Module({
  imports: [UsersModule],
  providers: [
    RateLimitService,
    SessionRevocationService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ActiveUserGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    AuditService,
    AdminScopeService,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    // Registered after idempotency, so it runs inside it: replayed responses are not logged again.
    { provide: APP_INTERCEPTOR, useClass: AuditTrailInterceptor },
  ],
  exports: [RateLimitService, SessionRevocationService, AuditService, AdminScopeService],
})
export class CommonModule {}
