import type { ProfileVisibility, UserStatus } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import { type Relationship, profileAccess } from './profile.policy.js';

const ctx = (
  relationship: Relationship,
  visibility: ProfileVisibility,
  extra: { blocked?: boolean; targetStatus?: UserStatus } = {},
) => ({
  relationship,
  visibility,
  blocked: extra.blocked ?? false,
  targetStatus: extra.targetStatus ?? 'active',
});

describe('profileAccess (F-ACC-05, F-SOC-05)', () => {
  it.each([
    ['everyone', 'none', 'full'],
    ['everyone', 'friend_of_friend', 'full'],
    ['friends_of_friends', 'none', 'limited'],
    ['friends_of_friends', 'friend_of_friend', 'full'],
    ['friends_of_friends', 'squad', 'full'],
    ['squad_only', 'none', 'limited'],
    ['squad_only', 'friend_of_friend', 'limited'],
    ['squad_only', 'squad', 'full'],
  ] as const)('visibility %s, viewer %s → %s', (visibility, relationship, expected) => {
    expect(profileAccess(ctx(relationship, visibility))).toBe(expected);
  });

  it('blocks hide profiles entirely, even from squad members', () => {
    expect(profileAccess(ctx('squad', 'everyone', { blocked: true }))).toBe('none');
  });

  it.each([
    'onboarding',
    'suspended',
    'banned',
    'deletion_pending',
    'deleted',
    'age_blocked',
  ] as const)('%s accounts are invisible', (targetStatus) => {
    expect(profileAccess(ctx('squad', 'everyone', { targetStatus }))).toBe('none');
  });

  it('you always see yourself', () => {
    expect(profileAccess(ctx('self', 'squad_only', { targetStatus: 'onboarding' }))).toBe('full');
  });
});
