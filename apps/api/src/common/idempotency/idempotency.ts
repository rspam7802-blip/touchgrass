import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IdempotencyKey } from '@touchgrass/shared';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import { from, type Observable, of, switchMap, catchError, throwError } from 'rxjs';
import { REDIS } from '../../infra/redis/redis.module.js';
import { AppError } from '../errors/app-error.js';
import { type AppRequest, clientIp } from '../http/request-context.js';

export const IDEMPOTENT = 'tg:idempotent';
/** Marks a retryable write endpoint (RSVP, payments, invites). Requires an `Idempotency-Key` header. */
export const Idempotent = (): MethodDecorator => SetMetadata(IDEMPOTENT, true);

const TTL_SECONDS = 24 * 60 * 60;
const IN_FLIGHT_TTL_SECONDS = 60;

interface StoredRecord {
  state: 'in_flight' | 'done';
  fingerprint: string;
  status?: number;
  body?: unknown;
}

export function requestFingerprint(req: AppRequest): string {
  return createHash('sha256')
    .update(`${req.method}\n${req.originalUrl}\n${JSON.stringify(req.body ?? null)}`)
    .digest('hex');
}

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (
      context.getType() !== 'http' ||
      !this.reflector.get<boolean | undefined>(IDEMPOTENT, context.getHandler())
    ) {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<AppRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    const header = req.header('idempotency-key');
    if (!header)
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required');
    const parsed = IdempotencyKey.safeParse(header);
    if (!parsed.success)
      throw new AppError('VALIDATION_FAILED', 'Idempotency-Key header is malformed');

    const scope = req.principal ? `u:${req.principal.userId}` : `ip:${clientIp(req)}`;
    const key = `idem:${scope}:${parsed.data}`;
    const fingerprint = requestFingerprint(req);

    return from(this.claim(key, fingerprint)).pipe(
      switchMap((existing) => {
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw new AppError(
              'IDEMPOTENCY_KEY_REUSED',
              'Idempotency-Key was already used for a different request',
            );
          }
          if (existing.state === 'in_flight') {
            throw new AppError(
              'CONFLICT',
              'A request with this Idempotency-Key is still being processed',
            );
          }
          res.status(existing.status ?? 200);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(existing.body);
        }
        return next.handle().pipe(
          switchMap((body: unknown) => {
            const record: StoredRecord = {
              state: 'done',
              fingerprint,
              status: res.statusCode,
              body,
            };
            return from(this.redis.set(key, JSON.stringify(record), 'EX', TTL_SECONDS)).pipe(
              switchMap(() => of(body)),
            );
          }),
          catchError((err: unknown) =>
            from(this.redis.del(key)).pipe(switchMap(() => throwError(() => err))),
          ),
        );
      }),
    );
  }

  /** Atomically claims the key. Returns the existing record if someone already claimed it. */
  private async claim(key: string, fingerprint: string): Promise<StoredRecord | null> {
    const record: StoredRecord = { state: 'in_flight', fingerprint };
    const ok = await this.redis.set(key, JSON.stringify(record), 'EX', IN_FLIGHT_TTL_SECONDS, 'NX');
    if (ok === 'OK') return null;
    const raw = await this.redis.get(key);
    return raw ? (JSON.parse(raw) as StoredRecord) : null;
  }
}
