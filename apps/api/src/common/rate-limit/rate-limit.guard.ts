import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { type AppRequest, clientIp } from '../http/request-context.js';
import { DEFAULT_RULES, RATE_LIMIT_RULES, type RateLimitRule } from './rate-limit.decorator.js';
import { RateLimitService } from './rate-limit.service.js';

export function bucketKey(rule: RateLimitRule, req: AppRequest): string | null {
  const ip = clientIp(req);
  switch (rule.by) {
    case 'ip':
      return `${rule.name}:ip:${ip}`;
    case 'anon-ip':
      return req.principal ? null : `${rule.name}:ip:${ip}`;
    case 'user':
      return req.principal ? `${rule.name}:u:${req.principal.userId}` : `${rule.name}:ip:${ip}`;
    case 'body': {
      const body = req.body as Record<string, unknown> | undefined;
      const value = rule.bodyField ? body?.[rule.bodyField] : undefined;
      if (typeof value !== 'string' || value.length === 0) return null;
      // Hash so raw identifiers (phone numbers) never appear in Redis keys.
      return `${rule.name}:b:${createHash('sha256').update(value).digest('hex').slice(0, 32)}`;
    }
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const specific = this.reflector.getAllAndOverride<RateLimitRule[] | undefined>(
      RATE_LIMIT_RULES,
      [context.getHandler(), context.getClass()],
    );
    const rules = [...DEFAULT_RULES, ...(specific ?? [])];
    const req = context.switchToHttp().getRequest<AppRequest>();
    const res = context.switchToHttp().getResponse<Response>();
    let tightest: { remaining: number; limit: number; resetMs: number } | null = null;
    for (const rule of rules) {
      const key = bucketKey(rule, req);
      if (!key) continue;
      const result = await this.limiter.consume(key, rule.limit, rule.windowSeconds * 1000);
      if (!result.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil(result.resetMs / 1000));
        res.setHeader('Retry-After', String(retryAfterSeconds));
        throw new AppError('RATE_LIMITED', 'Too many requests', {
          rule: rule.name,
          retryAfterSeconds,
        });
      }
      if (!tightest || result.remaining < tightest.remaining) tightest = result;
    }
    if (tightest) {
      res.setHeader('RateLimit-Limit', String(tightest.limit));
      res.setHeader('RateLimit-Remaining', String(tightest.remaining));
      res.setHeader('RateLimit-Reset', String(Math.ceil(tightest.resetMs / 1000)));
    }
    return true;
  }
}
