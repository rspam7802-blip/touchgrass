import { haversineMeters, LIMITS } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env.js';
import { CheckInService } from './check-in.service.js';
import { canInvite } from './event-invites.service.js';
import {
  balancedAllows,
  canViewEvent,
  checkInWindowOpen,
  type EventFacts,
  genderBucket,
  holdsSeat,
  isLateCancel,
  isLocationRevealed,
  materialChanges,
  revealTime,
  rsvpEligibility,
  type ViewerFacts,
  waitlistMode,
} from './event.policy.js';
import { randomSlug } from './events.service.js';
import { MYSTERY_AREA_RADIUS_M, mysteryCenter } from './mystery.js';

const NOW = new Date('2026-11-01T10:00:00Z');
const H = 3_600_000;

const event = (o: Partial<EventFacts> = {}): EventFacts => ({
  status: 'published',
  visibility: 'public',
  startsAt: new Date(NOW.getTime() + 24 * H),
  endsAt: new Date(NOW.getTime() + 27 * H),
  capacity: 10,
  balancedMaxSharePct: null,
  mystery: false,
  mysteryRevealMinutesBefore: 120,
  ...o,
});

const viewer = (o: Partial<ViewerFacts> = {}): ViewerFacts => ({
  hostRole: null,
  invited: false,
  rsvp: null,
  relationshipToHosts: 'none',
  blockedWithHost: false,
  gender: null,
  verified: false,
  ...o,
});

describe('canViewEvent (F-EVT-03, F-SAF-03)', () => {
  it('hosts always see their plan, even drafts', () => {
    expect(
      canViewEvent(
        viewer({ hostRole: 'co_host' }),
        event({ status: 'draft', visibility: 'invite_only' }),
      ),
    ).toBe(true);
  });
  it('blocks with any host hide the plan, even when invited', () => {
    expect(canViewEvent(viewer({ blockedWithHost: true, invited: true }), event())).toBe(false);
  });
  it('drafts are host-only', () => {
    expect(canViewEvent(viewer({ invited: true }), event({ status: 'draft' }))).toBe(false);
  });
  it.each([
    ['public', 'none', true],
    ['balanced', 'none', true],
    ['friends_of_friends', 'squad', true],
    ['friends_of_friends', 'friend_of_friend', true],
    ['friends_of_friends', 'none', false],
    ['invite_only', 'squad', false],
  ] as const)('%s visible to %s → %s', (visibility, rel, expected) => {
    expect(canViewEvent(viewer({ relationshipToHosts: rel }), event({ visibility }))).toBe(
      expected,
    );
  });
  it('an invite or an RSVP opens invite-only and fof plans', () => {
    expect(canViewEvent(viewer({ invited: true }), event({ visibility: 'invite_only' }))).toBe(
      true,
    );
    expect(
      canViewEvent(viewer({ rsvp: 'waitlisted' }), event({ visibility: 'friends_of_friends' })),
    ).toBe(true);
    expect(canViewEvent(viewer({ rsvp: 'cancelled' }), event({ visibility: 'invite_only' }))).toBe(
      false,
    );
  });
  it('women-only plans are visible to verified women only, invite or not', () => {
    const e = event({ visibility: 'women_only' });
    expect(canViewEvent(viewer({ gender: 'woman', verified: true }), e)).toBe(true);
    expect(canViewEvent(viewer({ gender: 'woman', verified: false, invited: true }), e)).toBe(
      false,
    );
    expect(canViewEvent(viewer({ gender: 'man', verified: true, invited: true }), e)).toBe(false);
  });
});

describe('rsvpEligibility', () => {
  it('reports a stable reason', () => {
    expect(rsvpEligibility(viewer({ hostRole: 'host' }), event(), NOW)).toEqual({
      ok: false,
      reason: 'HOST',
    });
    expect(rsvpEligibility(viewer({ blockedWithHost: true }), event(), NOW)).toEqual({
      ok: false,
      reason: 'BLOCKED',
    });
    expect(rsvpEligibility(viewer(), event({ status: 'cancelled' }), NOW)).toEqual({
      ok: false,
      reason: 'CLOSED',
    });
    expect(rsvpEligibility(viewer(), event({ endsAt: new Date(NOW.getTime() - 1) }), NOW)).toEqual({
      ok: false,
      reason: 'CLOSED',
    });
    expect(
      rsvpEligibility(viewer({ gender: 'woman' }), event({ visibility: 'women_only' }), NOW),
    ).toEqual({ ok: false, reason: 'VERIFICATION_REQUIRED' });
    expect(
      rsvpEligibility(
        viewer({ gender: 'man', verified: true }),
        event({ visibility: 'women_only' }),
        NOW,
      ),
    ).toEqual({ ok: false, reason: 'WOMEN_ONLY' });
    expect(rsvpEligibility(viewer(), event({ visibility: 'invite_only' }), NOW)).toEqual({
      ok: false,
      reason: 'NOT_INVITED',
    });
    expect(rsvpEligibility(viewer(), event(), NOW)).toEqual({ ok: true });
  });
});

describe('balanced plans (F-SAF-01)', () => {
  it('only verified gender counts; everyone else is "other"', () => {
    expect(genderBucket('woman', true)).toBe('woman');
    expect(genderBucket('man', true)).toBe('man');
    expect(genderBucket('woman', false)).toBe('other');
    expect(genderBucket('non_binary', true)).toBe('other');
    expect(genderBucket(null, false)).toBe('other');
  });
  it('caps each bucket at the share of capacity', () => {
    const e = event({ visibility: 'balanced', capacity: 10, balancedMaxSharePct: 60 });
    expect(balancedAllows(e, 5, 1)).toBe(true);
    expect(balancedAllows(e, 6, 1)).toBe(false);
    expect(balancedAllows(e, 5, 2)).toBe(false);
    expect(balancedAllows(event(), 100, 1)).toBe(true);
  });
});

describe('mystery reveal (F-EVT-12)', () => {
  const e = event({ mystery: true, mysteryRevealMinutesBefore: 120 });
  const reveal = revealTime(e);
  it('reveals at the configured time to people holding a seat', () => {
    expect(reveal.getTime()).toBe(e.startsAt.getTime() - 2 * H);
    expect(
      isLocationRevealed({ hostRole: null, rsvp: 'going' }, e, new Date(reveal.getTime() - 1)),
    ).toBe(false);
    expect(isLocationRevealed({ hostRole: null, rsvp: 'going' }, e, reveal)).toBe(true);
    expect(isLocationRevealed({ hostRole: null, rsvp: 'checked_in' }, e, reveal)).toBe(true);
  });
  it('never reveals to the waitlist, interested, cancelled or outsiders', () => {
    for (const rsvp of ['waitlisted', 'interested', 'cancelled', null] as const)
      expect(isLocationRevealed({ hostRole: null, rsvp }, e, e.endsAt)).toBe(false);
  });
  it('hosts always know; non-mystery plans are always exact', () => {
    expect(isLocationRevealed({ hostRole: 'welcome_host', rsvp: null }, e, NOW)).toBe(true);
    expect(isLocationRevealed({ hostRole: null, rsvp: null }, event(), NOW)).toBe(true);
  });
  it('the public centre is deterministic, 1–1.7 km away, and the area always contains the spot', () => {
    const exact = { lat: 17.4401, lng: 78.3489 };
    const centroid = { lat: 17.4435, lng: 78.3772 };
    for (let i = 0; i < 300; i += 1) {
      const id = `0192f3a4-5b6c-7d8e-9f01-${String(i).padStart(12, '0')}`;
      const c = mysteryCenter(
        id,
        exact,
        i % 2 === 0 ? centroid : null,
        'test-secret-test-secret-test-secret',
      );
      const d = haversineMeters(c, exact);
      expect(d).toBeGreaterThanOrEqual(LIMITS.mystery.minFuzzMeters - 1);
      expect(d).toBeLessThanOrEqual(MYSTERY_AREA_RADIUS_M - 300 + 1);
      expect(
        mysteryCenter(
          id,
          exact,
          i % 2 === 0 ? centroid : null,
          'test-secret-test-secret-test-secret',
        ),
      ).toEqual(c);
    }
  });
  it('falls back to offsetting the spot when the centroid is far away', () => {
    const exact = { lat: 17.4401, lng: 78.3489 };
    const farCentroid = { lat: 17.6, lng: 78.6 };
    const c = mysteryCenter(
      '0192f3a4-5b6c-7d8e-9f01-000000000001',
      exact,
      farCentroid,
      'another-secret-another-secret-xx',
    );
    const d = haversineMeters(c, exact);
    expect(d).toBeGreaterThanOrEqual(LIMITS.mystery.minFuzzMeters - 1);
    expect(d).toBeLessThanOrEqual(LIMITS.mystery.maxFuzzMeters + 1);
  });
});

describe('timing rules', () => {
  const e = event({
    startsAt: new Date(NOW.getTime() + H),
    endsAt: new Date(NOW.getTime() + 2 * H),
  });
  it('check-in opens 30 min before and closes 2 h after the start (or at the end)', () => {
    expect(checkInWindowOpen(e, new Date(NOW.getTime() + 29 * 60_000))).toBe(false);
    expect(checkInWindowOpen(e, new Date(NOW.getTime() + 30 * 60_000))).toBe(true);
    expect(checkInWindowOpen(e, new Date(NOW.getTime() + 2 * H))).toBe(true);
    expect(checkInWindowOpen(e, new Date(NOW.getTime() + 2 * H + 1))).toBe(false);
    expect(checkInWindowOpen({ ...e, status: 'cancelled' }, new Date(NOW.getTime() + H))).toBe(
      false,
    );
  });
  it('late cancel within 3 h; broadcast waitlist within 6 h', () => {
    expect(isLateCancel(e, NOW)).toBe(true);
    expect(isLateCancel(event(), NOW)).toBe(false);
    expect(waitlistMode(e, NOW)).toBe('broadcast');
    expect(waitlistMode(event(), NOW)).toBe('sequential');
  });
  it('seat holders are going or checked in', () => {
    expect(holdsSeat('going')).toBe(true);
    expect(holdsSeat('checked_in')).toBe(true);
    expect(holdsSeat('waitlisted')).toBe(false);
    expect(holdsSeat(null)).toBe(false);
  });
  it('material changes are time, place and price', () => {
    const base = {
      startsAt: NOW,
      endsAt: new Date(NOW.getTime() + H),
      locationKey: 'a',
      pricePaise: 0,
    };
    expect(materialChanges(base, { ...base })).toEqual([]);
    expect(
      materialChanges(base, {
        ...base,
        startsAt: new Date(NOW.getTime() + 1),
        locationKey: 'b',
        pricePaise: 100,
        endsAt: new Date(NOW.getTime() + 2 * H),
      }),
    ).toEqual(['startsAt', 'endsAt', 'location', 'price']);
  });
});

describe('who may invite (F-EVT-04)', () => {
  it('hosts always; people going for open plans; nobody else', () => {
    expect(
      canInvite(
        { status: 'published', visibility: 'invite_only' },
        { hostRole: 'host', rsvp: 'going' },
      ),
    ).toBe(true);
    expect(
      canInvite({ status: 'draft', visibility: 'public' }, { hostRole: 'host', rsvp: 'going' }),
    ).toBe(true);
    expect(
      canInvite({ status: 'draft', visibility: 'public' }, { hostRole: null, rsvp: 'going' }),
    ).toBe(false);
    expect(
      canInvite({ status: 'published', visibility: 'public' }, { hostRole: null, rsvp: 'going' }),
    ).toBe(true);
    expect(
      canInvite(
        { status: 'published', visibility: 'friends_of_friends' },
        { hostRole: null, rsvp: 'checked_in' },
      ),
    ).toBe(true);
    expect(
      canInvite(
        { status: 'published', visibility: 'invite_only' },
        { hostRole: null, rsvp: 'going' },
      ),
    ).toBe(false);
    expect(
      canInvite(
        { status: 'published', visibility: 'women_only' },
        { hostRole: null, rsvp: 'going' },
      ),
    ).toBe(false);
    expect(
      canInvite(
        { status: 'published', visibility: 'public' },
        { hostRole: null, rsvp: 'waitlisted' },
      ),
    ).toBe(false);
    expect(
      canInvite({ status: 'cancelled', visibility: 'public' }, { hostRole: 'host', rsvp: 'going' }),
    ).toBe(false);
  });
});

describe('tickets and slugs', () => {
  const svc = new CheckInService(
    null as never,
    { SIGNED_URL_SECRET: 'ticket-secret-ticket-secret-ticket-secret' } as Env,
    null as never,
    null as never,
    null as never,
    null as never,
  );
  const ev = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
  const user = '0192f3a4-5b6c-7d8e-9f01-23456789abce';
  it('round-trips a signed ticket and rejects tampering', () => {
    const code = svc.ticketCode(ev, user);
    expect(svc.parseTicket(code)).toEqual({ eventId: ev, userId: user });
    expect(svc.parseTicket(code.replace(user, ev))).toBeNull();
    expect(svc.parseTicket(`${code.slice(0, -1)}${code.endsWith('0') ? '1' : '0'}`)).toBeNull();
    expect(svc.parseTicket('nonsense')).toBeNull();
  });
  it('slugs are 8 unambiguous base62 characters', () => {
    // Enough samples that every alphabet character shows up, so a stray ambiguous one cannot slip through.
    const all = Array.from({ length: 2000 }, () => randomSlug()).join('');
    expect(all).toMatch(/^[A-Za-z2-9]+$/);
    expect(all).not.toMatch(/[01OIlo]/);
    expect(randomSlug()).toHaveLength(8);
  });
});
