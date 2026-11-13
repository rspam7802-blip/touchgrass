import { describe, expect, it } from 'vitest';
import { customerAccessFor, inviteForest } from './schemas/customer';

describe('Customer 360 access (D-192)', () => {
  it('admins and super admins see everything', () => {
    expect(customerAccessFor(['admin'])).toBe('full');
    expect(customerAccessFor(['super_admin'])).toBe('full');
    expect(customerAccessFor(['support', 'admin'])).toBe('full');
  });

  it('support sees the lighter view', () => {
    expect(customerAccessFor(['support'])).toBe('support');
    expect(customerAccessFor(['support', 'moderator'])).toBe('support');
  });

  it('moderators, curators and members cannot open it', () => {
    expect(customerAccessFor(['moderator'])).toBeNull();
    expect(customerAccessFor(['city_curator'])).toBeNull();
    expect(customerAccessFor([])).toBeNull();
  });
});

describe('invite forest (D-193)', () => {
  const at = new Date('2026-11-01T00:00:00Z');
  const p = (
    id: string,
    inviterId: string | null,
    entry: 'team' | 'member' | 'open' = 'member',
  ) => ({
    id,
    inviterId,
    entry,
    joinedAt: at,
  });

  it('numbers generations from the team’s first invitees and counts whole families', () => {
    const f = inviteForest([
      p('a', null, 'team'),
      p('b', 'a'),
      p('c', 'a'),
      p('d', 'b'),
      p('e', 'd'),
      p('z', null, 'open'),
    ]);
    expect(f.get('a')).toEqual({ generation: 1, direct: 2, descendants: 4 });
    expect(f.get('b')).toEqual({ generation: 2, direct: 1, descendants: 2 });
    expect(f.get('e')).toEqual({ generation: 4, direct: 0, descendants: 0 });
    expect(f.get('z')).toEqual({ generation: 1, direct: 0, descendants: 0 });
  });

  it('starts a new family when the inviter is outside the list, and survives a cycle', () => {
    const f = inviteForest([p('x', 'gone'), p('y', 'x'), p('m', 'n'), p('n', 'm')]);
    expect(f.get('x')?.generation).toBe(1);
    expect(f.get('y')?.generation).toBe(2);
    expect(f.size).toBe(4);
  });
});
