import { normalizeE164 } from '@touchgrass/shared';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../errors/app-error.js';
import type { AppRequest } from '../http/request-context.js';
import { RateLimit, type RateLimitRule } from './rate-limit.decorator.js';
import { bucketKey, RateLimitGuard } from './rate-limit.guard.js';
import type { RateLimitService } from './rate-limit.service.js';

const req = (extra: Partial<AppRequest> = {}): AppRequest =>
  ({ ip: '10.0.0.1', socket: {}, body: {}, ...extra }) as unknown as AppRequest;

describe('bucketKey', () => {
  const rule = (by: RateLimitRule['by'], bodyField?: string): RateLimitRule => ({
    name: 'r',
    limit: 1,
    windowSeconds: 1,
    by,
    bodyField,
  });
  it('keys by ip, user (falling back to ip) and hashed body field', () => {
    expect(bucketKey(rule('ip'), req())).toBe('r:ip:10.0.0.1');
    expect(bucketKey(rule('anon-ip'), req())).toBe('r:ip:10.0.0.1');
    expect(
      bucketKey(rule('anon-ip'), req({ principal: { userId: 'u1', sessionId: 's', roles: [] } })),
    ).toBeNull();
    expect(bucketKey(rule('user'), req())).toBe('r:ip:10.0.0.1');
    expect(
      bucketKey(rule('user'), req({ principal: { userId: 'u1', sessionId: 's', roles: [] } })),
    ).toBe('r:u:u1');
    const key = bucketKey(rule('body', 'phone'), req({ body: { phone: '+919848022338' } }));
    expect(key).toMatch(/^r:b:[0-9a-f]{32}$/);
    expect(key).not.toContain('9848022338');
    expect(bucketKey(rule('body', 'phone'), req())).toBeNull();
  });

  it('keys a normalised body field the same however it is formatted', () => {
    const phoneRule = { ...rule('body', 'phone'), normalize: normalizeE164 };
    const keys = ['+919848022338', '+91 98480 22338', '98480-22338', '+91a9848022338'].map(
      (phone) => bucketKey(phoneRule, req({ body: { phone } })),
    );
    expect(new Set(keys).size).toBe(1);
  });
});

describe('RateLimitGuard', () => {
  class Ctl {
    @RateLimit({ name: 'otp', limit: 1, windowSeconds: 60, by: 'ip' })
    handler(): void {
      return undefined;
    }
  }
  const ctx = (type = 'http') => {
    const res = { setHeader: vi.fn() };
    const context = {
      getType: () => type,
      getHandler: () =>
        Object.getOwnPropertyDescriptor(Ctl.prototype, 'handler')?.value as () => void,
      getClass: () => Ctl,
      switchToHttp: () => ({ getRequest: () => req(), getResponse: () => res }),
    } as unknown as ExecutionContext;
    return { res, context };
  };

  it('allows and sets headers when under the limit', async () => {
    const limiter = {
      consume: vi.fn().mockResolvedValue({ allowed: true, limit: 10, remaining: 9, resetMs: 1000 }),
    };
    const { res, context } = ctx();
    await expect(
      new RateLimitGuard(new Reflector(), limiter as unknown as RateLimitService).canActivate(
        context,
      ),
    ).resolves.toBe(true);
    expect(limiter.consume).toHaveBeenCalledTimes(3);
    expect(res.setHeader).toHaveBeenCalledWith('RateLimit-Remaining', '9');
  });
  it('throws RATE_LIMITED with Retry-After when exceeded', async () => {
    const limiter = {
      consume: vi.fn().mockResolvedValue({ allowed: false, limit: 1, remaining: 0, resetMs: 2500 }),
    };
    const { res, context } = ctx();
    await expect(
      new RateLimitGuard(new Reflector(), limiter as unknown as RateLimitService).canActivate(
        context,
      ),
    ).rejects.toBeInstanceOf(AppError);
    expect(res.setHeader).toHaveBeenCalledWith('Retry-After', '3');
  });
  it('skips non-http contexts', async () => {
    const limiter = { consume: vi.fn() };
    await expect(
      new RateLimitGuard(new Reflector(), limiter as unknown as RateLimitService).canActivate(
        ctx('ws').context,
      ),
    ).resolves.toBe(true);
    expect(limiter.consume).not.toHaveBeenCalled();
  });
});
