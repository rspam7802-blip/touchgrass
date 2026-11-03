import { FeedQuery } from '@touchgrass/shared';
import { describe, expect, it } from 'vitest';
import { filterHash } from './discovery.service.js';
import {
  clusterCellDegrees,
  clusterPoints,
  DISCOVERY_WEIGHTS,
  type RankFeatures,
  scoreEvent,
  timeWindow,
  weatherFit,
} from './ranking.js';
import { WeatherService } from './weather.service.js';

const base: RankFeatures = {
  interestMatches: 0,
  vibeMatches: 0,
  squadGoing: 0,
  friendsOfFriendsGoing: 0,
  distanceMeters: 8000,
  hoursUntilStart: 120,
  fillRatio: 0,
  soloFriendly: false,
  viewerSquadSize: 10,
  weatherFit: 0,
  hoursSincePublished: 200,
  hostRating: null,
};

describe('scoreEvent (F-DSC-07)', () => {
  it('is deterministic and explains itself', () => {
    const a = scoreEvent({ ...base, interestMatches: 1, squadGoing: 1 });
    expect(scoreEvent({ ...base, interestMatches: 1, squadGoing: 1 })).toEqual(a);
    expect(a.reasons).toEqual(['squad_going', 'interests']);
  });
  it('rewards each signal and never prefers a worse plan', () => {
    const plain = scoreEvent(base).score;
    for (const better of [
      { interestMatches: 1 },
      { vibeMatches: 1 },
      { squadGoing: 1 },
      { friendsOfFriendsGoing: 1 },
      { distanceMeters: 500 },
      { hoursUntilStart: 2 },
      { fillRatio: 0.6 },
      { soloFriendly: true },
      { weatherFit: 1 as const },
      { hoursSincePublished: 1 },
    ])
      expect(scoreEvent({ ...base, ...better }).score).toBeGreaterThan(plain);
    expect(scoreEvent({ ...base, weatherFit: -1 }).score).toBeLessThan(plain);
  });
  it('squad going outweighs a single shared interest; full plans are not "popular"', () => {
    expect(scoreEvent({ ...base, squadGoing: 1 }).score).toBeGreaterThan(
      scoreEvent({ ...base, interestMatches: 1 }).score,
    );
    expect(scoreEvent({ ...base, fillRatio: 1 }).reasons).not.toContain('popular');
    expect(scoreEvent({ ...base, fillRatio: 0.9 }).reasons).toContain('popular');
  });
  it('labels nearby, soon and solo-friendly (more for small squads)', () => {
    const r = scoreEvent({
      ...base,
      distanceMeters: 800,
      hoursUntilStart: 0,
      soloFriendly: true,
      viewerSquadSize: 2,
    });
    expect(r.reasons).toEqual(expect.arrayContaining(['nearby', 'soon', 'solo_friendly']));
    expect(scoreEvent({ ...base, soloFriendly: true, viewerSquadSize: 2 }).score).toBeGreaterThan(
      scoreEvent({ ...base, soloFriendly: true, viewerSquadSize: 20 }).score,
    );
  });
  it('takes custom weights', () => {
    const noSquad = { ...DISCOVERY_WEIGHTS, squadGoing: 0 };
    expect(scoreEvent({ ...base, squadGoing: 3 }, noSquad).reasons).not.toContain('squad_going');
  });
});

describe('time windows (IST)', () => {
  // Wednesday 4 Nov 2026, 12:00 IST.
  const wed = new Date('2026-11-04T06:30:00.000Z');
  it('tonight runs to 3 am, tomorrow is the next day, any spans the horizon', () => {
    expect(timeWindow('tonight', wed, 30)).toEqual({
      from: wed,
      to: new Date('2026-11-04T21:30:00.000Z'),
    });
    expect(timeWindow('tomorrow', wed, 30)).toEqual({
      from: new Date('2026-11-04T18:30:00.000Z'),
      to: new Date('2026-11-05T18:30:00.000Z'),
    });
    expect(timeWindow('any', wed, 30).to.getTime() - wed.getTime()).toBe(30 * 86_400_000);
  });
  it('weekend is Saturday–Sunday, or from now while it is the weekend', () => {
    expect(timeWindow('weekend', wed, 30)).toEqual({
      from: new Date('2026-11-06T18:30:00.000Z'),
      to: new Date('2026-11-08T18:30:00.000Z'),
    });
    const sat = new Date('2026-11-07T10:00:00.000Z');
    expect(timeWindow('weekend', sat, 30)).toEqual({
      from: sat,
      to: new Date('2026-11-08T18:30:00.000Z'),
    });
    const sun = new Date('2026-11-08T10:00:00.000Z');
    expect(timeWindow('weekend', sun, 30)).toEqual({
      from: sun,
      to: new Date('2026-11-08T18:30:00.000Z'),
    });
  });
});

describe('weather (F-DSC-08)', () => {
  it('rain, storms and heat favour indoor; pleasant dry weather favours outdoor', () => {
    const rain = { condition: 'rain' as const, tempC: 25, precipitationProbability: 0.9 };
    expect(weatherFit(rain, true)).toEqual({ fit: 1, advice: 'indoor' });
    expect(weatherFit(rain, false)).toEqual({ fit: -1, advice: null });
    expect(
      weatherFit({ condition: 'clear', tempC: 39, precipitationProbability: 0 }, true).advice,
    ).toBe('indoor');
    expect(
      weatherFit({ condition: 'clouds', tempC: 26, precipitationProbability: 0.7 }, false).fit,
    ).toBe(-1);
    expect(
      weatherFit({ condition: 'clear', tempC: 26, precipitationProbability: 0 }, false),
    ).toEqual({ fit: 1, advice: 'outdoor' });
    expect(
      weatherFit({ condition: 'clear', tempC: 26, precipitationProbability: 0 }, true),
    ).toEqual({ fit: 0, advice: null });
    expect(
      weatherFit({ condition: 'clear', tempC: 12, precipitationProbability: 0 }, false),
    ).toEqual({ fit: 0, advice: null });
    expect(weatherFit(null, false)).toEqual({ fit: 0, advice: null });
  });
  it('finds the forecast hour covering a time', () => {
    const hours = [
      {
        time: '2026-11-04T06:00:00.000Z',
        tempC: 30,
        condition: 'clear' as const,
        precipitationProbability: 0,
      },
      {
        time: '2026-11-04T07:00:00.000Z',
        tempC: 31,
        condition: 'rain' as const,
        precipitationProbability: 0.8,
      },
    ];
    expect(WeatherService.atTime(hours, new Date('2026-11-04T07:30:00.000Z'))?.condition).toBe(
      'rain',
    );
    expect(WeatherService.atTime(hours, new Date('2026-11-04T09:00:00.000Z'))).toBeNull();
    expect(WeatherService.atTime(null, new Date())).toBeNull();
  });
});

describe('map clustering (F-DSC-03)', () => {
  it('groups dense cells, keeps sparse pins, and stops clustering when zoomed in', () => {
    const cell = clusterCellDegrees(12);
    const dense = Array.from({ length: 4 }, (_, i) => ({
      id: `d${String(i)}`,
      lat: 17.44 + (i * cell) / 100,
      lng: 78.35,
    }));
    const lone = { id: 'lone', lat: 17.9, lng: 78.9 };
    const out = clusterPoints([...dense, lone], 12);
    expect(out.clusters).toHaveLength(1);
    expect(out.clusters[0]?.count).toBe(4);
    expect(out.singles.map((s) => s.id)).toEqual(['lone']);
    expect(clusterPoints([...dense, lone], 16).clusters).toEqual([]);
  });
});

describe('feed cache key', () => {
  const parse = (q: Record<string, string>) => FeedQuery.parse(q);
  it('ignores paging and GPS jitter but not filters', () => {
    const a = filterHash(parse({ lat: '17.44361', lng: '78.35190', limit: '10' }));
    expect(filterHash(parse({ lat: '17.44362', lng: '78.35191', limit: '20' }))).toBe(a);
    expect(filterHash(parse({ lat: '17.44361', lng: '78.35190', free: 'true' }))).not.toBe(a);
    expect(filterHash(parse({ lat: '17.45', lng: '78.35190' }))).not.toBe(a);
  });
  it('query flags only accept true/false and lat/lng travel together', () => {
    expect(parse({ free: 'false' }).free).toBe(false);
    expect(FeedQuery.safeParse({ free: 'yes' }).success).toBe(false);
    expect(FeedQuery.safeParse({ lat: '17.4' }).success).toBe(false);
    expect(parse({ interestIds: '0192f3a4-5b6c-7d8e-9f01-23456789abcd' }).interestIds).toHaveLength(
      1,
    );
  });
});
