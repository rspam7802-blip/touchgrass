import { describe, expect, it } from 'vitest';
import {
  AddLoreBody,
  averageRating,
  FeedbackBody,
  isPopularPlan,
  type ReliabilityEventInput,
  reliabilityOutcome,
} from './after';

const NOW = new Date('2026-11-01T12:00:00.000Z');
const daysAgo = (d: number): Date => new Date(NOW.getTime() - d * 86_400_000);
const ev = (kind: ReliabilityEventInput['kind'], d: number): ReliabilityEventInput => ({
  kind,
  at: daysAgo(d),
});

describe('reliability (F-SAF-02)', () => {
  it('is "new" with fewer than three commitments in a year', () => {
    expect(reliabilityOutcome([], NOW)).toEqual({
      score: 100,
      tier: 'new',
      noShowsRecent: 0,
      cooldownUntil: null,
    });
    expect(
      reliabilityOutcome([ev('check_in', 1), ev('check_in', 400), ev('check_in', 500)], NOW).tier,
    ).toBe('new');
  });

  it('maps the decayed kept share to tiers', () => {
    const always = [1, 8, 15, 22].map((d) => ev('check_in', d));
    expect(reliabilityOutcome(always, NOW).tier).toBe('super_reliable');
    expect(reliabilityOutcome([...always, ev('late_cancel', 3)], NOW).tier).toBe('reliable');
    expect(
      reliabilityOutcome([ev('check_in', 5), ev('check_in', 6), ev('no_show', 150)], NOW).tier,
    ).toBe('reliable');
    expect(
      reliabilityOutcome([ev('check_in', 5), ev('check_in', 6), ev('no_show', 7)], NOW).tier,
    ).toBe('hit_or_miss');
    expect(
      reliabilityOutcome([ev('check_in', 5), ev('no_show', 6), ev('no_show', 70)], NOW).tier,
    ).toBe('flaky');
  });

  it('recent no-shows count more than old ones', () => {
    const recent = reliabilityOutcome(
      [ev('check_in', 200), ev('check_in', 200), ev('no_show', 1)],
      NOW,
    );
    const old = reliabilityOutcome([ev('check_in', 1), ev('check_in', 1), ev('no_show', 200)], NOW);
    expect(recent.score).toBeLessThan(old.score);
  });

  it('two no-shows within 60 days start a 14-day cooldown from the latest one', () => {
    const r = reliabilityOutcome([ev('no_show', 10), ev('no_show', 3), ev('check_in', 1)], NOW);
    expect(r.noShowsRecent).toBe(2);
    expect(r.cooldownUntil?.toISOString()).toBe(
      new Date(daysAgo(3).getTime() + 14 * 86_400_000).toISOString(),
    );
    expect(reliabilityOutcome([ev('no_show', 61), ev('no_show', 3)], NOW).cooldownUntil).toBeNull();
    expect(
      reliabilityOutcome([ev('no_show', 30), ev('no_show', 20)], NOW).cooldownUntil,
    ).toBeNull();
  });
});

describe('popular plans and averages', () => {
  it('a plan is popular when nearly full or waitlisted', () => {
    expect(isPopularPlan(10, 8, 0)).toBe(true);
    expect(isPopularPlan(10, 7, 0)).toBe(false);
    expect(isPopularPlan(10, 2, 1)).toBe(true);
    expect(isPopularPlan(4, 3, 0)).toBe(true);
  });
  it('averages to one decimal, null without ratings', () => {
    expect(averageRating(14, 3)).toBe(4.7);
    expect(averageRating(0, 0)).toBeNull();
  });
});

describe('after-event request schemas', () => {
  it('feedback defaults and bounds', () => {
    expect(FeedbackBody.parse({ rating: 5 })).toEqual({
      rating: 5,
      hostRating: null,
      great: [],
      improve: [],
      comment: '',
    });
    expect(FeedbackBody.safeParse({ rating: 6 }).success).toBe(false);
    expect(FeedbackBody.safeParse({ rating: 4, great: ['nope'] }).success).toBe(false);
    expect(FeedbackBody.safeParse({ rating: 4, comment: 'x'.repeat(1001) }).success).toBe(false);
  });
  it('lore captions are trimmed and bounded', () => {
    const id = '0192f3a4-5b6c-7d8e-9f01-000000000001';
    expect(AddLoreBody.parse({ mediaId: id, caption: '  sunset  ' }).caption).toBe('sunset');
    expect(AddLoreBody.safeParse({ mediaId: id, caption: 'x'.repeat(201) }).success).toBe(false);
  });
});
