import { describe, expect, it } from 'vitest';
import { EventVisibility, RsvpStatus, AdminRole, NotificationCategory } from './enums';
import { SOCKET_NAMESPACES } from './socket';

describe('enums', () => {
  it('exposes the spec-defined value sets', () => {
    expect(EventVisibility.options).toEqual([
      'public',
      'friends_of_friends',
      'invite_only',
      'women_only',
      'men_only',
      'balanced',
    ]);
    expect(RsvpStatus.options).toContain('checked_in');
    expect(AdminRole.options).toContain('city_curator');
    expect(NotificationCategory.safeParse('spam').success).toBe(false);
    expect(SOCKET_NAMESPACES.chat).toBe('/chat');
  });
});
