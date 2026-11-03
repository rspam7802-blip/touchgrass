import { ChallengeCriteria } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import {
  canManage,
  canSeeCrew,
  memberAction,
  membershipChange,
  missingOccurrences,
} from '../crews/crews.policy.js';
import {
  deadlineBlock,
  isVotingOpen,
  lockBlock,
  timeOptionBlock,
} from '../proposals/proposals.policy.js';
import { rejectReason } from '../referrals/referrals.service.js';
import {
  challengeProgress,
  challengeState,
  placeKey,
  type QualifyingCheckIn,
} from './challenges.service.js';
import { mostFrequent } from './recaps.service.js';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const ctx = { admins: 1, activeCount: 3, maxMembers: 200 };
const admin = { role: 'admin' as const, status: 'active' as const };
const memberM = { role: 'member' as const, status: 'active' as const };

describe('crew rules (F-ENG-02)', () => {
  it('who sees and runs a crew', () => {
    const open = { status: 'active' as const, joinPolicy: 'request' as const };
    const closed = { status: 'active' as const, joinPolicy: 'invite_only' as const };
    expect(canSeeCrew(open, null)).toBe(true);
    expect(canSeeCrew(closed, null)).toBe(false);
    expect(canSeeCrew(closed, { role: 'member', status: 'invited' })).toBe(true);
    expect(canSeeCrew({ ...open, status: 'archived' }, memberM)).toBe(true);
    expect(canSeeCrew({ ...open, status: 'archived' }, null)).toBe(false);
    expect(canManage(admin)).toBe(true);
    expect(canManage({ role: 'admin', status: 'invited' })).toBe(false);
    expect(canManage(null)).toBe(false);
  });

  it('joining, accepting, declining and leaving', () => {
    expect(membershipChange('request', null, 'join', ctx)).toEqual({
      kind: 'insert',
      status: 'requested',
    });
    expect(membershipChange('invite_only', null, 'join', ctx)).toEqual({
      kind: 'error',
      reason: 'CREW_INVITE_ONLY',
    });
    expect(
      membershipChange('invite_only', { role: 'member', status: 'invited' }, 'join', ctx),
    ).toEqual({ kind: 'activate' });
    expect(
      membershipChange('request', { role: 'member', status: 'requested' }, 'join', ctx),
    ).toEqual({ kind: 'none' });
    expect(membershipChange('request', memberM, 'join', ctx)).toEqual({
      kind: 'error',
      reason: 'ALREADY_IN',
    });
    expect(membershipChange('request', null, 'join', { ...ctx, activeCount: 200 })).toEqual({
      kind: 'error',
      reason: 'CREW_FULL',
    });
    expect(
      membershipChange('request', { role: 'member', status: 'invited' }, 'accept', ctx),
    ).toEqual({ kind: 'activate' });
    expect(
      membershipChange('request', { role: 'member', status: 'invited' }, 'accept', {
        ...ctx,
        activeCount: 200,
      }),
    ).toEqual({ kind: 'error', reason: 'CREW_FULL' });
    expect(membershipChange('request', null, 'accept', ctx)).toEqual({
      kind: 'error',
      reason: 'NOT_INVITED',
    });
    expect(
      membershipChange('request', { role: 'member', status: 'requested' }, 'decline', ctx),
    ).toEqual({ kind: 'delete' });
    expect(membershipChange('request', memberM, 'decline', ctx)).toEqual({
      kind: 'error',
      reason: 'NOT_INVITED',
    });
    expect(membershipChange('request', admin, 'leave', ctx)).toEqual({
      kind: 'error',
      reason: 'LAST_ADMIN',
    });
    expect(membershipChange('request', admin, 'leave', { ...ctx, activeCount: 1 })).toEqual({
      kind: 'delete',
    });
    expect(membershipChange('request', admin, 'leave', { ...ctx, admins: 2 })).toEqual({
      kind: 'delete',
    });
    expect(membershipChange('request', null, 'leave', ctx)).toEqual({
      kind: 'error',
      reason: 'NOT_CREW_MEMBER',
    });
  });

  it('admin actions on others', () => {
    const requested = { role: 'member' as const, status: 'requested' as const };
    expect(memberAction(memberM, false, requested, 'approve', ctx)).toEqual({
      kind: 'error',
      reason: 'CREW_ADMIN_ONLY',
    });
    expect(memberAction(admin, false, null, 'approve', ctx)).toEqual({
      kind: 'error',
      reason: 'NOT_FOUND',
    });
    expect(memberAction(admin, false, requested, 'approve', ctx)).toEqual({ kind: 'activate' });
    expect(memberAction(admin, false, requested, 'approve', { ...ctx, activeCount: 200 })).toEqual({
      kind: 'error',
      reason: 'CREW_FULL',
    });
    expect(memberAction(admin, false, memberM, 'approve', ctx)).toEqual({
      kind: 'error',
      reason: 'NOT_FOUND',
    });
    expect(memberAction(admin, false, requested, 'decline', ctx)).toEqual({ kind: 'delete' });
    expect(memberAction(admin, false, memberM, 'decline', ctx)).toEqual({
      kind: 'error',
      reason: 'NOT_FOUND',
    });
    expect(memberAction(admin, false, memberM, 'remove', ctx)).toEqual({ kind: 'delete' });
    expect(memberAction(admin, true, admin, 'remove', ctx)).toEqual({
      kind: 'error',
      reason: 'NOT_FOUND',
    });
    expect(memberAction(admin, false, requested, 'remove', ctx)).toEqual({
      kind: 'error',
      reason: 'NOT_FOUND',
    });
    expect(memberAction(admin, false, memberM, 'make_admin', ctx)).toEqual({
      kind: 'role',
      role: 'admin',
    });
    expect(memberAction(admin, false, admin, 'make_admin', ctx)).toEqual({
      kind: 'error',
      reason: 'NOT_FOUND',
    });
    expect(memberAction(admin, false, admin, 'make_member', { ...ctx, admins: 2 })).toEqual({
      kind: 'role',
      role: 'member',
    });
    expect(memberAction(admin, true, admin, 'make_member', ctx)).toEqual({
      kind: 'error',
      reason: 'LAST_ADMIN',
    });
    expect(memberAction(admin, false, memberM, 'make_member', ctx)).toEqual({
      kind: 'error',
      reason: 'NOT_FOUND',
    });
  });

  it('only missing occurrences become sessions', () => {
    const a = new Date('2026-11-08T00:30:00Z');
    const b = new Date('2026-11-15T00:30:00Z');
    expect(missingOccurrences([a, b], new Set([a.getTime()]))).toEqual([b]);
  });
});

describe('proposal rules (F-ENG-03)', () => {
  const p = {
    status: 'open' as const,
    deadline: new Date(NOW.getTime() + 3_600_000),
    creatorId: 'me',
  };
  it('voting, locking and deadlines', () => {
    expect(isVotingOpen(p, NOW)).toBe(true);
    expect(isVotingOpen(p, new Date(p.deadline.getTime() + 1))).toBe(false);
    expect(isVotingOpen({ ...p, status: 'locked' }, NOW)).toBe(false);
    expect(lockBlock(p, 'me')).toBeNull();
    expect(lockBlock(p, 'you')).toBe('NOT_HOST');
    expect(lockBlock({ ...p, status: 'cancelled' }, 'me')).toBe('PROPOSAL_CLOSED');
    expect(deadlineBlock(new Date(NOW.getTime() + 10 * 60_000), NOW)).toBe('BAD_DEADLINE');
    expect(deadlineBlock(new Date(NOW.getTime() + 15 * 86_400_000), NOW)).toBe('BAD_DEADLINE');
    expect(deadlineBlock(new Date(NOW.getTime() + 86_400_000), NOW)).toBeNull();
    expect(timeOptionBlock(NOW, NOW)).toBe('TIME_PASSED');
    expect(timeOptionBlock(new Date(NOW.getTime() + 200 * 86_400_000), NOW)).toBe('TIME_PASSED');
    expect(timeOptionBlock(new Date(NOW.getTime() + 86_400_000), NOW)).toBeNull();
  });
});

describe('challenge progress (F-GAM-03)', () => {
  const ci = (over: Partial<QualifyingCheckIn>): QualifyingCheckIn => ({
    userId: 'u',
    eventId: 'e1',
    venueId: null,
    neighbourhoodId: null,
    categoryId: 'cafe',
    ...over,
  });
  const yes = () => true;

  it('places: venues, else the neighbourhood of a pinned spot', () => {
    expect(placeKey(ci({ venueId: 'v', neighbourhoodId: 'n' }), 'venueId')).toBe('venue:v');
    expect(placeKey(ci({ neighbourhoodId: 'n' }), 'venueId')).toBe('hood:n');
    expect(placeKey(ci({ venueId: 'v' }), 'neighbourhoodId')).toBeNull();
    expect(placeKey(ci({}), 'venueId')).toBeNull();
  });

  it('counts outings once, filters by category, new places and squad, caps at the target', () => {
    const criteria = ChallengeCriteria.parse({ target: 3 });
    const during = [
      ci({ userId: 'a' }),
      ci({ userId: 'b' }),
      ci({ eventId: 'e2' }),
      ci({ eventId: 'e3', categoryId: 'run' }),
    ];
    expect(challengeProgress(criteria, during, [], yes)).toBe(3);
    expect(challengeProgress({ ...criteria, categoryInterestId: 'cafe' }, during, [], yes)).toBe(2);
    expect(
      challengeProgress({ ...criteria, withSquad: true }, during, [], (c) => c.eventId === 'e2'),
    ).toBe(1);
    expect(challengeProgress({ ...criteria, target: 1 }, during, [], yes)).toBe(1);
    const venues = [
      ci({ venueId: 'v1' }),
      ci({ eventId: 'e2', venueId: 'v1' }),
      ci({ eventId: 'e3', venueId: 'v2' }),
    ];
    expect(challengeProgress({ ...criteria, distinct: 'venueId' }, venues, [], yes)).toBe(2);
    expect(
      challengeProgress(
        { ...criteria, distinct: 'venueId', newPlacesOnly: true },
        venues,
        [ci({ venueId: 'v1', eventId: 'old' })],
        yes,
      ),
    ).toBe(1);
    expect(challengeProgress({ ...criteria, newPlacesOnly: true }, [ci({})], [], yes)).toBe(0);
  });

  it('state follows the window', () => {
    const c = { startsAt: new Date(NOW.getTime() + 1), endsAt: new Date(NOW.getTime() + 2) };
    expect(challengeState(c, NOW)).toBe('upcoming');
    expect(challengeState(c, new Date(NOW.getTime() + 1))).toBe('active');
    expect(challengeState(c, new Date(NOW.getTime() + 2))).toBe('ended');
  });
});

describe('referral fraud checks and recap helpers (F-GRW-01, F-GAM-04)', () => {
  const r = { refereePhoneHash: 'h', refereeDeviceId: 'd' };
  const base = {
    phoneRewarded: false,
    deviceRewarded: false,
    referrerRewarded: 0,
    maxRewarded: 20,
  };
  it('one reward per phone and device, within the referrer limit', () => {
    expect(rejectReason(r, base)).toBeNull();
    expect(rejectReason(r, { ...base, phoneRewarded: true })).toBe('DUPLICATE_PHONE');
    expect(rejectReason(r, { ...base, deviceRewarded: true })).toBe('DUPLICATE_DEVICE');
    expect(
      rejectReason({ ...r, refereeDeviceId: null }, { ...base, deviceRewarded: true }),
    ).toBeNull();
    expect(rejectReason(r, { ...base, referrerRewarded: 20 })).toBe('LIMIT_REACHED');
  });
  it('most frequent value, first seen wins ties', () => {
    expect(mostFrequent([])).toBeNull();
    expect(mostFrequent(['a', 'b', 'b', 'a', 'c'])).toBe('a');
    expect(mostFrequent(['x', 'y', 'y'])).toBe('y');
  });
});
