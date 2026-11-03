import { describe, expect, it } from 'vitest';
import { DISCOVERY_WEIGHTS, scoreEvent } from '../discovery/ranking.js';
import { feedbackBlock, feedbackOpenUntil, tally } from '../feedback/feedback.policy.js';
import { coverSource, loreAccess } from '../lore/lore.policy.js';
import { reconnectState } from './after.service.js';

const END = new Date('2026-11-01T14:30:00.000Z');
const DAY = 86_400_000;

describe('feedback window (F-AFT-02)', () => {
  const plan = { status: 'completed', endsAt: END };
  const guest = { checkedIn: true, isHost: false };
  it('checked-in guests, after the end, for 14 days', () => {
    expect(feedbackBlock(guest, plan, new Date(END.getTime() + DAY))).toBeNull();
    expect(feedbackBlock(guest, plan, new Date(END.getTime() - 1))).toBe('NOT_YET');
    expect(feedbackBlock(guest, plan, new Date(END.getTime() + 14 * DAY + 1))).toBe(
      'FEEDBACK_CLOSED',
    );
    expect(feedbackBlock({ checkedIn: false, isHost: false }, plan, END)).toBe('NOT_ATTENDED');
    expect(feedbackBlock({ checkedIn: true, isHost: true }, plan, END)).toBe('HOST');
    expect(feedbackBlock(guest, { ...plan, status: 'cancelled' }, END)).toBe('FEEDBACK_CLOSED');
    expect(feedbackOpenUntil(END).getTime()).toBe(END.getTime() + 14 * DAY);
  });
  it('tallies tags, most common first then alphabetically', () => {
    expect(tally([['b', 'a'], ['a'], ['c', 'b']], 2)).toEqual([
      { tag: 'a', count: 2 },
      { tag: 'b', count: 2 },
    ]);
  });
});

describe('reconnect state (F-AFT-03)', () => {
  it('squad wins, then my pull, then theirs', () => {
    expect(reconnectState('squad', true, true)).toBe('squad');
    expect(reconnectState('request_sent', true, false)).toBe('pulled');
    expect(reconnectState('none', false, true)).toBe('pulled_you');
    expect(reconnectState('request_received', false, false)).toBe('pulled_you');
    expect(reconnectState('request_sent', false, false)).toBe('request_sent');
    expect(reconnectState('none', false, false)).toBe('none');
  });
});

describe('Lore access (F-AFT-04)', () => {
  const started = { status: 'completed', startsAt: new Date(END.getTime() - 2 * 3_600_000) };
  const outsider = { attended: false, isHost: false, squadOfAttendee: false };
  it('attendees and hosts; squads only when allowed; nothing before the start or when cancelled', () => {
    expect(loreAccess({ ...outsider, attended: true }, started, 'attendees', END)).toEqual({
      view: true,
      add: true,
      manage: false,
    });
    expect(loreAccess({ ...outsider, isHost: true }, started, 'attendees', END)).toEqual({
      view: true,
      add: true,
      manage: true,
    });
    expect(loreAccess({ ...outsider, squadOfAttendee: true }, started, 'attendees', END).view).toBe(
      false,
    );
    expect(
      loreAccess({ ...outsider, squadOfAttendee: true }, started, 'friends_of_attendees', END),
    ).toEqual({ view: true, add: false, manage: false });
    expect(loreAccess(outsider, started, 'friends_of_attendees', END).view).toBe(false);
    expect(
      loreAccess(
        { ...outsider, attended: true },
        { ...started, status: 'cancelled' },
        'attendees',
        END,
      ).view,
    ).toBe(false);
    expect(
      loreAccess(
        { ...outsider, isHost: true },
        { status: 'published', startsAt: new Date(END.getTime() + 1) },
        'attendees',
        END,
      ).view,
    ).toBe(false);
    expect(coverSource(['a', 'b'])).toBe('a,b');
  });
});

describe('top hosts in ranking (F-AFT-05)', () => {
  const base = {
    interestMatches: 0,
    vibeMatches: 0,
    squadGoing: 0,
    friendsOfFriendsGoing: 0,
    distanceMeters: 8000,
    hoursUntilStart: 120,
    fillRatio: 0,
    soloFriendly: false,
    viewerSquadSize: 10,
    weatherFit: 0 as const,
    hoursSincePublished: 200,
    hostRating: null,
  };
  it('5★ hosts earn the full weight and a reason; ≤3.5★ and unrated hosts are neutral', () => {
    const top = scoreEvent({ ...base, hostRating: 5 });
    const plain = scoreEvent(base);
    expect(top.score - plain.score).toBeCloseTo(DISCOVERY_WEIGHTS.hostRating);
    expect(top.reasons).toContain('top_host');
    expect(scoreEvent({ ...base, hostRating: 3.2 }).score).toBe(plain.score);
  });
});
