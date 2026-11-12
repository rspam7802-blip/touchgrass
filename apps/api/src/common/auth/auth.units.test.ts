import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import type { UsersService } from '../../modules/users/users.service.js';
import { testEnv } from '../../test-support/env.js';
import { ActiveUserGuard, isStaffRoute } from './active-user.guard.js';
import { AuthGuard } from './auth.guard.js';
import { AllowOnboarding, Public, Roles } from './decorators.js';
import {
  pepperedHash,
  randomInviteCode,
  randomNumericCode,
  randomToken,
  safeEqualHex,
} from './hashing.js';
import { signAccessToken } from './jwt.js';
import type { SessionRevocationService } from './revocation.service.js';
import { hasAnyRole, RolesGuard } from './roles.guard.js';

const env = testEnv();
const ids = {
  sub: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
  sid: '0192f3a4-5b6c-7d8e-9f01-23456789abce',
};

class Ctl {
  @Public()
  open(): void {
    return undefined;
  }
  closed(): void {
    return undefined;
  }
  @Roles('moderator')
  mod(): void {
    return undefined;
  }
  @AllowOnboarding()
  setup(): void {
    return undefined;
  }
}

function ctx(handler: keyof Ctl, req: Record<string, unknown>, type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => Object.getOwnPropertyDescriptor(Ctl.prototype, handler)?.value as () => void,
    getClass: () => Ctl,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}
const req = (authorization?: string) =>
  ({ header: (n: string) => (n === 'authorization' ? authorization : undefined) }) as Record<
    string,
    unknown
  >;
const revocations = (revoked: boolean) =>
  ({ isRevoked: vi.fn().mockResolvedValue(revoked) }) as unknown as SessionRevocationService;

describe('AuthGuard', () => {
  const guard = (revoked = false) => new AuthGuard(new Reflector(), revocations(revoked), env);
  it('attaches the principal for a valid token', async () => {
    const r = req(
      `Bearer ${signAccessToken({ ...ids, roles: ['admin'] }, env.JWT_ACCESS_SECRET, 900)}`,
    );
    await expect(guard().canActivate(ctx('closed', r))).resolves.toBe(true);
    expect(r.principal).toEqual({ userId: ids.sub, sessionId: ids.sid, roles: ['admin'] });
  });
  it('maps missing, expired, invalid and revoked tokens', async () => {
    await expect(guard().canActivate(ctx('closed', req()))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const expired = signAccessToken(
      ids,
      env.JWT_ACCESS_SECRET,
      900,
      new Date(Date.now() - 3_600_000),
    );
    await expect(
      guard().canActivate(ctx('closed', req(`Bearer ${expired}`))),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    await expect(guard().canActivate(ctx('closed', req('Bearer nope')))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    const ok = signAccessToken(ids, env.JWT_ACCESS_SECRET, 900);
    await expect(guard(true).canActivate(ctx('closed', req(`Bearer ${ok}`)))).rejects.toMatchObject(
      { code: 'SESSION_REVOKED' },
    );
  });
  it('public routes pass anonymously or with bad tokens, without a principal', async () => {
    for (const r of [req(), req('Bearer junk')]) {
      await expect(guard().canActivate(ctx('open', r))).resolves.toBe(true);
      expect(r.principal).toBeUndefined();
    }
    const revokedReq = req(`Bearer ${signAccessToken(ids, env.JWT_ACCESS_SECRET, 900)}`);
    await expect(guard(true).canActivate(ctx('open', revokedReq))).resolves.toBe(true);
    await expect(guard().canActivate(ctx('closed', req(), 'ws'))).resolves.toBe(true);
  });
});

describe('RolesGuard', () => {
  it('treats super_admin as holding every role', () => {
    expect(hasAnyRole(['super_admin'], ['moderator'])).toBe(true);
    expect(hasAnyRole(['support'], ['moderator', 'support'])).toBe(true);
    expect(hasAnyRole([], ['admin'])).toBe(false);
    expect(hasAnyRole([], [])).toBe(true);
  });
  it('enforces @Roles on handlers', () => {
    const g = new RolesGuard(new Reflector());
    expect(g.canActivate(ctx('closed', {}))).toBe(true);
    expect(() => g.canActivate(ctx('mod', {}))).toThrow(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }) as Error,
    );
    expect(() => g.canActivate(ctx('mod', { principal: { roles: ['support'] } }))).toThrow(
      expect.objectContaining({ code: 'FORBIDDEN' }) as Error,
    );
    expect(g.canActivate(ctx('mod', { principal: { roles: ['moderator'] } }))).toBe(true);
    expect(g.canActivate(ctx('mod', {}, 'ws'))).toBe(true);
  });
});

describe('ActiveUserGuard', () => {
  const guard = (status: string | null) =>
    new ActiveUserGuard(new Reflector(), {
      statusOf: vi.fn().mockResolvedValue(status),
    } as unknown as UsersService);
  const p = { principal: { userId: ids.sub, sessionId: ids.sid, roles: [] } };
  it('lets active users through and gates onboarding users to allowed routes', async () => {
    await expect(guard('active').canActivate(ctx('closed', p))).resolves.toBe(true);
    await expect(guard('onboarding').canActivate(ctx('setup', p))).resolves.toBe(true);
    await expect(guard('onboarding').canActivate(ctx('closed', p))).rejects.toMatchObject({
      code: 'ONBOARDING_INCOMPLETE',
    });
  });
  it('lets staff still onboarding use the admin routes their role allows, and nothing else', async () => {
    const staff = { principal: { ...p.principal, roles: ['moderator'] } };
    await expect(guard('onboarding').canActivate(ctx('mod', staff))).resolves.toBe(true);
    await expect(guard('onboarding').canActivate(ctx('closed', staff))).rejects.toMatchObject({
      code: 'ONBOARDING_INCOMPLETE',
    });
    await expect(guard('onboarding').canActivate(ctx('mod', p))).rejects.toMatchObject({
      code: 'ONBOARDING_INCOMPLETE',
    });
    expect(isStaffRoute(['moderator'], ['super_admin'])).toBe(true);
    expect(isStaffRoute(['moderator'], ['support'])).toBe(false);
    expect(isStaffRoute([], ['super_admin'])).toBe(false);
    expect(isStaffRoute(undefined, ['super_admin'])).toBe(false);
  });
  it('never blocks public routes (e.g. requesting a code) for a half-finished sign-up', async () => {
    await expect(guard('onboarding').canActivate(ctx('open', p))).resolves.toBe(true);
  });
  it.each([
    [null, 'SESSION_REVOKED'],
    ['deleted', 'SESSION_REVOKED'],
    ['deletion_pending', 'SESSION_REVOKED'],
    ['suspended', 'ACCOUNT_SUSPENDED'],
    ['banned', 'ACCOUNT_SUSPENDED'],
    ['age_blocked', 'AGE_RESTRICTED'],
  ])('status %s → %s', async (status, code) => {
    await expect(guard(status).canActivate(ctx('setup', p))).rejects.toMatchObject({ code });
  });
  it('ignores anonymous and non-http requests', async () => {
    await expect(guard('banned').canActivate(ctx('open', {}))).resolves.toBe(true);
    await expect(guard('banned').canActivate(ctx('open', p, 'ws'))).resolves.toBe(true);
  });
});

describe('hashing helpers', () => {
  it('peppered hashes differ by pepper and compare in constant time', () => {
    const a = pepperedHash('p1', 'x');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(pepperedHash('p2', 'x')).not.toBe(a);
    expect(safeEqualHex(a, a)).toBe(true);
    expect(safeEqualHex(a, a.slice(2))).toBe(false);
  });
  it('generates codes from the right alphabets', () => {
    expect(randomNumericCode(6)).toMatch(/^\d{6}$/);
    expect(randomInviteCode(200)).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
