import { describe, expect, it } from 'vitest';
import { pingRefusal, pingThrottleKey } from './availability.policy.js';

const now = new Date('2026-11-03T12:00:00Z');
const base = {
  fromId: 'a',
  toId: 'b',
  inSquad: true,
  blockedEitherWay: false,
  targetFreeUntil: new Date('2026-11-03T14:00:00Z'),
  now,
};

describe('pingRefusal', () => {
  it('lets squad members ping someone who is free right now', () => {
    expect(pingRefusal(base)).toBeNull();
  });
  it('refuses pinging yourself', () => {
    expect(pingRefusal({ ...base, toId: 'a' })).toBe('self');
  });
  it('hides people outside the squad and blocks behind "not found"', () => {
    expect(pingRefusal({ ...base, inSquad: false })).toBe('not_found');
    expect(pingRefusal({ ...base, blockedEitherWay: true })).toBe('not_found');
    // A block wins even when they are free and in the squad.
    expect(pingRefusal({ ...base, blockedEitherWay: true, targetFreeUntil: null })).toBe(
      'not_found',
    );
  });
  it('refuses when they are no longer (or never were) free', () => {
    expect(pingRefusal({ ...base, targetFreeUntil: null })).toBe('not_free');
    expect(pingRefusal({ ...base, targetFreeUntil: now })).toBe('not_free');
  });
  it('throttles per ordered pair', () => {
    expect(pingThrottleKey('a', 'b')).not.toBe(pingThrottleKey('b', 'a'));
  });
});
