import { describe, expect, it } from 'vitest';
import { isoWeekKey } from '../time';
import { pickWinner } from './engagement';
import {
  BadgeRule,
  ChallengeCriteria,
  type FactRow,
  freezeMonth,
  isoWeekMonday,
  previousRecapKey,
  recapWindow,
  ruleProgress,
  shiftIsoWeek,
  shouldFreeze,
  streakState,
  UpsertBadgeBody,
  UpsertChallengeBody,
} from './gamification';
import { isReferralCode } from './referrals';

const checkIn = (attrs: FactRow['attrs'] = {}): FactRow => ({ kind: 'check_in', attrs });

describe('badge rules (F-GAM-01)', () => {
  it('count, optionally only on-time check-ins', () => {
    const facts = [
      checkIn({ onTime: true }),
      checkIn({ onTime: false }),
      checkIn({ onTime: true }),
    ];
    const count = BadgeRule.parse({ type: 'count', fact: 'check_in', threshold: 10 });
    expect(ruleProgress(count, facts)).toEqual({ current: 3, target: 10 });
    const early = BadgeRule.parse({
      type: 'count',
      fact: 'check_in',
      threshold: 2,
      onTimeOnly: true,
    });
    expect(ruleProgress(early, facts)).toEqual({ current: 2, target: 2 });
  });

  it('distinct values ignore blanks; group_count takes the biggest group; capped at the target', () => {
    const facts = [
      checkIn({ neighbourhoodId: 'a' }),
      checkIn({ neighbourhoodId: 'a' }),
      checkIn({ neighbourhoodId: 'b' }),
      checkIn({ neighbourhoodId: null }),
      { kind: 'crew_session' as const, attrs: { crewId: 'x' } },
      { kind: 'crew_session' as const, attrs: { crewId: 'x' } },
      { kind: 'crew_session' as const, attrs: { crewId: 'y' } },
      { kind: 'crew_session' as const, attrs: {} },
    ];
    expect(
      ruleProgress(
        { type: 'distinct', fact: 'check_in', field: 'neighbourhoodId', threshold: 5 },
        facts,
      ),
    ).toEqual({ current: 2, target: 5 });
    expect(
      ruleProgress(
        { type: 'group_count', fact: 'crew_session', field: 'crewId', threshold: 1 },
        facts,
      ),
    ).toEqual({ current: 1, target: 1 });
    expect(
      ruleProgress({ type: 'group_count', fact: 'hosted', field: 'crewId', threshold: 3 }, facts),
    ).toEqual({ current: 0, target: 3 });
  });

  it('admin bodies need every language and a sane key', () => {
    const body = {
      key: 'chai_hopper',
      name: { en: 'Chai Hopper', te: 'చాయ్ హాపర్', hi: 'चाय हॉपर' },
      description: { en: '5 cafés', te: '5 కేఫ్‌లు', hi: '5 कैफ़े' },
      emoji: '☕',
      rule: { type: 'distinct', fact: 'check_in', field: 'venueId', threshold: 5 },
    };
    expect(UpsertBadgeBody.parse(body).active).toBe(true);
    expect(UpsertBadgeBody.safeParse({ ...body, key: 'Bad Key' }).success).toBe(false);
    expect(UpsertBadgeBody.safeParse({ ...body, name: { en: 'x', te: '', hi: 'y' } }).success).toBe(
      false,
    );
    expect(
      UpsertBadgeBody.safeParse({ ...body, name: { ...body.name, en: 'x'.repeat(41) } }).success,
    ).toBe(false);
  });
});

describe('weekly streaks (F-GAM-02)', () => {
  it('week keys round-trip through Mondays', () => {
    expect(isoWeekMonday('2026-W44').toISOString()).toBe('2026-10-26T00:00:00.000Z');
    expect(shiftIsoWeek('2026-W01', -1)).toBe('2025-W52');
    expect(shiftIsoWeek('2026-W53', 1)).toBe('2027-W01');
    expect(freezeMonth('2026-W44')).toBe('2026-10');
    expect(isoWeekKey(new Date('2026-11-01T12:00:00Z'))).toBe('2026-W44');
    expect(() => isoWeekMonday('nope')).toThrow('Not an ISO week');
  });

  it('counts back from this week, or last week while this one is in progress', () => {
    const out = new Set(['2026-W40', '2026-W41', '2026-W43']);
    const frozen = new Set(['2026-W42']);
    expect(streakState(out, frozen, '2026-W44')).toEqual({
      current: 4,
      longest: 4,
      thisWeek: false,
    });
    expect(streakState(new Set([...out, '2026-W44']), frozen, '2026-W44')).toEqual({
      current: 5,
      longest: 5,
      thisWeek: true,
    });
    expect(streakState(out, new Set(), '2026-W45')).toEqual({
      current: 0,
      longest: 2,
      thisWeek: false,
    });
    expect(streakState(new Set(), new Set(), '2026-W45')).toEqual({
      current: 0,
      longest: 0,
      thisWeek: false,
    });
  });

  it('freezes a missed week once per month, only to save a live streak', () => {
    const out = new Set(['2026-W40', '2026-W41']);
    expect(shouldFreeze(out, new Set(), '2026-W42')).toBe(true);
    expect(shouldFreeze(out, new Set(), '2026-W41')).toBe(false); // they went out
    expect(shouldFreeze(new Set(['2026-W39']), new Set(), '2026-W41')).toBe(false); // already broken
    // W42 (Mon 12 Oct) and W43 (Mon 19 Oct) are both October: only one freeze.
    expect(shouldFreeze(out, new Set(['2026-W42']), '2026-W43')).toBe(false);
    // W45 starts in November, so November's freeze is still free.
    expect(shouldFreeze(new Set(['2026-W44']), new Set(['2026-W42']), '2026-W45')).toBe(true);
  });
});

describe('challenges, recaps, votes, referral codes', () => {
  it('challenge bodies validate dates and default the criteria', () => {
    const body = {
      title: { en: 'Café crawl', te: 'కేఫ్ క్రాల్', hi: 'कैफ़े क्रॉल' },
      description: { en: '3 new cafés', te: '3 కొత్త కేఫ్‌లు', hi: '3 नए कैफ़े' },
      emoji: '☕',
      startsAt: '2026-11-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z',
      mode: 'solo',
      criteria: { target: 3 },
    };
    expect(UpsertChallengeBody.parse(body).criteria).toEqual(
      ChallengeCriteria.parse({
        target: 3,
        distinct: null,
        newPlacesOnly: false,
        withSquad: false,
      }),
    );
    expect(UpsertChallengeBody.safeParse({ ...body, endsAt: body.startsAt }).success).toBe(false);
  });

  it('recap windows follow IST months and years', () => {
    expect(recapWindow('month', '2026-10')).toEqual({
      from: new Date('2026-09-30T18:30:00.000Z'),
      to: new Date('2026-10-31T18:30:00.000Z'),
    });
    expect(recapWindow('year', '2026').to.toISOString()).toBe('2026-12-31T18:30:00.000Z');
    expect(() => recapWindow('month', '2026-1')).toThrow('Bad recap month');
    expect(() => recapWindow('year', '26')).toThrow('Bad recap year');
    // 1 Nov 00:10 IST is still 31 Oct in UTC; the month that just ended is October.
    expect(previousRecapKey('month', new Date('2026-10-31T18:40:00Z'))).toBe('2026-10');
    expect(previousRecapKey('month', new Date('2027-01-01T00:00:00Z'))).toBe('2026-12');
    expect(previousRecapKey('year', new Date('2027-01-01T00:00:00Z'))).toBe('2026');
  });

  it('most votes wins, ties go to the earlier suggestion', () => {
    const at = (s: string) => new Date(s);
    expect(pickWinner([])).toBeNull();
    expect(
      pickWinner([
        { id: 'a', votes: 2, createdAt: at('2026-11-01T10:00:00Z') },
        { id: 'b', votes: 3, createdAt: at('2026-11-01T11:00:00Z') },
        { id: 'c', votes: 3, createdAt: at('2026-11-01T09:00:00Z') },
      ])?.id,
    ).toBe('c');
  });

  it('referral codes look like TG + six unambiguous characters', () => {
    expect(isReferralCode('TG7K2P9Q')).toBe(true);
    expect(isReferralCode(' tg7k2p9q ')).toBe(true);
    expect(isReferralCode('TG7K2P9O')).toBe(false); // O is ambiguous
    expect(isReferralCode('GRASS-2026')).toBe(false);
  });
});
