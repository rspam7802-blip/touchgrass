import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AdminRole } from '@touchgrass/shared';
import { from, mergeMap, Observable } from 'rxjs';
import { REQUIRED_ROLES } from '../auth/decorators.js';
import type { AppRequest } from '../http/request-context.js';
import { auditContext, type AuditContextState } from './audit-context.js';
import { AuditService } from './audit.service.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SECRET_KEY = /phone|email|token|secret|password|otp|pin/i;
const MAX_VALUE = 200;

/** Top-level body fields worth keeping in the log: no secrets or contact details, long text cut short. */
export function auditDetails(
  params: Record<string, string>,
  body: unknown,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) continue;
      if (typeof v === 'string') fields[k] = v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v;
      else if (typeof v === 'number' || typeof v === 'boolean' || v === null) fields[k] = v;
      else fields[k] = Array.isArray(v) ? `[${String(v.length)} items]` : '{…}';
    }
  }
  return { params, fields };
}

/**
 * Every admin action is audit-logged (F-WEB-03). Services record specific entries in the same transaction
 * as their change; this interceptor wraps every non-GET route that requires an admin role and, when the
 * handler succeeded without recording anything, writes a generic entry naming the route, its parameters
 * and the request's non-sensitive fields. Runs inside the idempotency interceptor, so replays aren't logged twice.
 */
@Injectable()
export class AuditTrailInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<AppRequest>();
    const roles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length || req.method === 'GET' || req.method === 'HEAD' || !req.principal)
      return next.handle();
    const principal = req.principal;
    const state: AuditContextState = { audited: false };
    return new Observable((subscriber) => {
      auditContext.run(state, () => {
        next
          .handle()
          .pipe(
            mergeMap((value: unknown) =>
              from(
                (async () => {
                  if (!state.audited) {
                    const params = req.params as Record<string, string>;
                    const id = Object.values(params).find((v) => UUID.test(v)) ?? null;
                    const route = (req.route as { path?: string } | undefined)?.path ?? req.path;
                    await this.audit.record({
                      adminUserId: principal.userId,
                      action: `${req.method.toLowerCase()} ${route.replace(/^\/v\d+\//, '')}`,
                      targetType: route.replace(/^\/v\d+\//, '').split('/')[1] ?? 'admin',
                      targetId: id,
                      details: auditDetails(params, req.body),
                    });
                  }
                  return value;
                })(),
              ),
            ),
          )
          .subscribe(subscriber);
      });
    });
  }
}
