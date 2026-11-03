import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { cityScopeFor, inScope } from '../auth/admin-scope.js';
import { Roles } from '../auth/decorators.js';
import { normalizeCityName } from '../../modules/cities/city-waitlist.service.js';
import { dayIn } from '../../modules/analytics/analytics-counters.service.js';
import { markAudited } from './audit-context.js';
import { auditDetails, AuditTrailInterceptor } from './audit-trail.interceptor.js';
import type { AuditService } from './audit.service.js';

class Ctl {
  @Roles('admin')
  write(): void {}
  open(): void {}
}

const USER = '01a191b3-b484-7df4-b0a2-89dfe5eef7c7';

function ctx(handler: keyof Ctl, req: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'http',
    getHandler: () => Object.getOwnPropertyDescriptor(Ctl.prototype, handler)?.value as () => void,
    getClass: () => Ctl,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

const adminReq = (over: Record<string, unknown> = {}) => ({
  method: 'PUT',
  principal: { userId: USER, sessionId: 's', roles: ['admin'] },
  params: { id: USER },
  route: { path: '/v1/admin/things/:id' },
  path: `/v1/admin/things/${USER}`,
  body: { name: 'x', phone: '+919999999999', tags: ['a', 'b'] },
  ...over,
});

function setup() {
  const record = vi.fn().mockResolvedValue(undefined);
  const audit = { record } as unknown as AuditService;
  return { record, interceptor: new AuditTrailInterceptor(new Reflector(), audit) };
}

describe('AuditTrailInterceptor (every admin action is audit-logged)', () => {
  it('writes a generic entry when an admin write recorded nothing', async () => {
    const { record, interceptor } = setup();
    const next: CallHandler = { handle: () => of('done') };
    expect(await firstValueFrom(interceptor.intercept(ctx('write', adminReq()), next))).toBe(
      'done',
    );
    expect(record).toHaveBeenCalledWith({
      adminUserId: USER,
      action: 'put admin/things/:id',
      targetType: 'things',
      targetId: USER,
      details: { params: { id: USER }, fields: { name: 'x', tags: '[2 items]' } },
    });
  });

  it('adds nothing when the handler recorded its own entry', async () => {
    const { record, interceptor } = setup();
    const next: CallHandler = {
      handle: () =>
        of(null).pipe((source) => {
          markAudited();
          return source;
        }),
    };
    await firstValueFrom(interceptor.intercept(ctx('write', adminReq()), next));
    expect(record).not.toHaveBeenCalled();
  });

  it('skips reads, routes without roles and failed handlers', async () => {
    const { record, interceptor } = setup();
    await firstValueFrom(
      interceptor.intercept(ctx('write', adminReq({ method: 'GET' })), { handle: () => of(1) }),
    );
    await firstValueFrom(interceptor.intercept(ctx('open', adminReq()), { handle: () => of(1) }));
    await expect(
      firstValueFrom(
        interceptor.intercept(ctx('write', adminReq()), {
          handle: () => throwError(() => new Error('boom')),
        }),
      ),
    ).rejects.toThrow('boom');
    expect(record).not.toHaveBeenCalled();
  });

  it('keeps contact details and secrets out of the details and trims long text', () => {
    const long = 'a'.repeat(300);
    expect(
      auditDetails(
        {},
        { email: 'x@y.z', staffPin: '1234', note: long, ok: true, n: 2, nested: { a: 1 } },
      ),
    ).toEqual({
      params: {},
      fields: { note: `${'a'.repeat(200)}…`, ok: true, n: 2, nested: '{…}' },
    });
    expect(auditDetails({ k: 'v' }, ['not', 'an', 'object'])).toEqual({
      params: { k: 'v' },
      fields: {},
    });
  });
});

describe('city scope policy (D-118)', () => {
  it('lets admins act everywhere and curators only in their cities', () => {
    expect(cityScopeFor(['admin'], [])).toBe('all');
    expect(cityScopeFor(['super_admin', 'city_curator'], ['c1'])).toBe('all');
    expect(cityScopeFor(['city_curator'], ['c1'])).toEqual(['c1']);
    expect(cityScopeFor(['moderator'], [])).toBe('all');
    expect(inScope(['c1'], 'c1')).toBe(true);
    expect(inScope(['c1'], 'c2')).toBe(false);
    expect(inScope(['c1'], null)).toBe(false);
    expect(inScope('all', null)).toBe(true);
  });
});

describe('helpers', () => {
  it('treats spacing and case as the same requested city', () => {
    expect(normalizeCityName('  New   DELHI ')).toBe('new delhi');
  });

  it('counts a moment on the local calendar day of its city', () => {
    // 20:00 UTC is already the next day in IST.
    expect(dayIn(new Date('2026-11-02T20:00:00Z'), 'Asia/Kolkata')).toBe('2026-11-03');
    expect(dayIn(new Date('2026-11-02T20:00:00Z'), 'UTC')).toBe('2026-11-02');
  });
});
