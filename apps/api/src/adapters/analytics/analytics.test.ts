import { describe, expect, it } from 'vitest';
import { fakeFetch, jsonBody } from '../../test-support/env.js';
import { AnalyticsPiiError, assertNoPii, NoopAnalyticsSink } from './analytics.port.js';
import { PostHogAnalyticsSink } from './posthog.js';

describe('analytics PII guard', () => {
  it('allows ids, enums and counts', () => {
    expect(() =>
      assertNoPii({ eventId: '0192f3a4', category: 'chai', count: 3, paid: false, plusOne: null }),
    ).not.toThrow();
    expect(() => assertNoPii()).not.toThrow();
  });
  it('rejects PII-shaped keys and values', () => {
    expect(() => assertNoPii({ phone: 'x' })).toThrow(AnalyticsPiiError);
    expect(() => assertNoPii({ userLat: 17 })).toThrow(AnalyticsPiiError);
    expect(() => assertNoPii({ ref: '+91 98480 22338' })).toThrow(AnalyticsPiiError);
    expect(() => assertNoPii({ ref: 'someone@example.com' })).toThrow(AnalyticsPiiError);
  });
});

describe('sinks', () => {
  it('noop sink still enforces the guard', async () => {
    await expect(
      new NoopAnalyticsSink().capture([{ distinctId: 'u', event: 'pull_up' }]),
    ).resolves.toBeUndefined();
    await expect(
      new NoopAnalyticsSink().capture([
        { distinctId: 'u', event: 'x', properties: { email: 'a' } },
      ]),
    ).rejects.toThrow(AnalyticsPiiError);
  });
  it('posthog sink batches without person profiles', async () => {
    const f = fakeFetch([{ body: { status: 1 } }]);
    const sink = new PostHogAnalyticsSink('phc_key', 'https://eu.i.posthog.com/', f.fetch);
    await sink.capture([
      {
        distinctId: 'u1',
        event: 'pull_up',
        properties: { eventId: 'e1' },
        timestamp: new Date('2026-10-31T00:00:00Z'),
      },
    ]);
    await sink.capture([]);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.url).toBe('https://eu.i.posthog.com/batch/');
    expect(jsonBody(f.calls[0]?.init)).toEqual({
      api_key: 'phc_key',
      batch: [
        {
          event: 'pull_up',
          distinct_id: 'u1',
          properties: { eventId: 'e1', $process_person_profile: false },
          timestamp: '2026-10-31T00:00:00.000Z',
        },
      ],
    });
    await expect(
      sink.capture([{ distinctId: 'u', event: 'x', properties: { name: 'A' } }]),
    ).rejects.toThrow(AnalyticsPiiError);
  });
});
