import { describe, expect, it } from 'vitest';
import {
  decideRequest,
  DECLINE_COOLDOWN_MS,
  orderedPair,
  relationshipFrom,
} from './graph/friendship.policy.js';
import { uuidArrayLiteral } from './graph/social-graph.service.js';
import { CATEGORY_SEVERITY, escalate, maxSeverity } from './reports/report-severity.js';
import { ReportTargetRegistry } from './reports/report-targets.registry.js';
import { isMeaningful, scoreSuggestion, suggestionReasons } from './suggestions.scoring.js';

const A = '0192f3a4-5b6c-7d8e-9f01-00000000000a';
const B = '0192f3a4-5b6c-7d8e-9f01-00000000000b';
const now = new Date('2026-10-31T00:00:00Z');

describe('friendship policy', () => {
  it('orders pairs canonically', () => {
    expect(orderedPair(B, A)).toEqual([A, B]);
    expect(orderedPair(A, B)).toEqual([A, B]);
  });
  it('derives the viewer-relative relationship', () => {
    expect(relationshipFrom(A, null)).toBe('none');
    expect(relationshipFrom(A, { status: 'accepted', requesterId: B, respondedAt: now })).toBe(
      'squad',
    );
    expect(relationshipFrom(A, { status: 'pending', requesterId: A, respondedAt: null })).toBe(
      'request_sent',
    );
    expect(relationshipFrom(A, { status: 'pending', requesterId: B, respondedAt: null })).toBe(
      'request_received',
    );
    expect(relationshipFrom(A, { status: 'declined', requesterId: A, respondedAt: now })).toBe(
      'none',
    );
  });
  it('decides what a new request does', () => {
    expect(decideRequest(A, null, now)).toEqual({ action: 'create_or_reopen' });
    expect(decideRequest(A, { status: 'accepted', requesterId: B, respondedAt: now }, now)).toEqual(
      { action: 'none', relationship: 'squad' },
    );
    expect(decideRequest(A, { status: 'pending', requesterId: A, respondedAt: null }, now)).toEqual(
      { action: 'none', relationship: 'request_sent' },
    );
    expect(decideRequest(A, { status: 'pending', requesterId: B, respondedAt: null }, now)).toEqual(
      { action: 'accept_reverse' },
    );
    expect(
      decideRequest(A, { status: 'cancelled', requesterId: B, respondedAt: now }, now),
    ).toEqual({ action: 'create_or_reopen' });
  });
  it('keeps declined requests silently "sent" during the cooldown, then allows a fresh one', () => {
    const declined = (at: Date, requester = A) => ({
      status: 'declined' as const,
      requesterId: requester,
      respondedAt: at,
    });
    expect(decideRequest(A, declined(now), now)).toEqual({
      action: 'none',
      relationship: 'request_sent',
    });
    expect(
      decideRequest(A, declined(new Date(now.getTime() - DECLINE_COOLDOWN_MS - 1)), now),
    ).toEqual({ action: 'create_or_reopen' });
    expect(decideRequest(A, declined(now, B), now)).toEqual({ action: 'create_or_reopen' });
  });
});

describe('suggestion scoring', () => {
  const s = (o: Partial<Parameters<typeof scoreSuggestion>[0]>) => ({
    mutualFriends: 0,
    inContacts: false,
    sharedInterests: 0,
    sharedEvents: 0,
    ...o,
  });
  it('weights contacts and shared events above interests, with diminishing mutuals', () => {
    expect(scoreSuggestion(s({}))).toBe(0);
    expect(scoreSuggestion(s({ inContacts: true }))).toBe(5);
    expect(scoreSuggestion(s({ mutualFriends: 1 }))).toBe(3);
    expect(scoreSuggestion(s({ mutualFriends: 4 }))).toBe(9);
    expect(scoreSuggestion(s({ mutualFriends: 50 }))).toBe(
      scoreSuggestion(s({ mutualFriends: 10 })),
    );
    expect(scoreSuggestion(s({ sharedEvents: 1 }))).toBeGreaterThan(
      scoreSuggestion(s({ sharedInterests: 3 })),
    );
  });
  it('explains itself and filters weak interest-only matches', () => {
    expect(
      suggestionReasons(
        s({ inContacts: true, mutualFriends: 2, sharedEvents: 1, sharedInterests: 1 }),
      ),
    ).toEqual(['contact', 'mutual_friends', 'shared_events', 'shared_interests']);
    expect(isMeaningful(s({ sharedInterests: 1 }))).toBe(false);
    expect(isMeaningful(s({ sharedInterests: 2 }))).toBe(true);
    expect(isMeaningful(s({ mutualFriends: 1 }))).toBe(true);
    expect(isMeaningful(s({ inContacts: true }))).toBe(true);
    expect(isMeaningful(s({ sharedEvents: 1 }))).toBe(true);
  });
});

describe('report severity routing', () => {
  it('maps categories and escalates with independent reporters', () => {
    expect(CATEGORY_SEVERITY.underage).toBe('critical');
    expect(CATEGORY_SEVERITY.spam).toBe('low');
    expect(escalate('low', 1)).toBe('low');
    expect(escalate('low', 3)).toBe('medium');
    expect(escalate('low', 10)).toBe('high');
    expect(escalate('high', 10)).toBe('critical');
    expect(escalate('critical', 50)).toBe('critical');
    expect(maxSeverity('low', 'high')).toBe('high');
    expect(maxSeverity('critical', 'medium')).toBe('critical');
  });
  it('registers one resolver per target type', () => {
    const reg = new ReportTargetRegistry();
    const resolver = { type: 'user' as const, resolve: () => Promise.resolve(null) };
    reg.register(resolver);
    expect(reg.get('user')).toBe(resolver);
    expect(reg.get('event')).toBeUndefined();
    expect(() => reg.register(resolver)).toThrow(/Duplicate/);
  });
});

describe('graph helpers', () => {
  it('builds a single bound array literal from validated ids', () => {
    expect(uuidArrayLiteral([A, B])).toBe(`{${A},${B}}`);
    expect(() => uuidArrayLiteral(["x'); DROP TABLE users;--"])).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }) as Error,
    );
  });
});
