import { describe, expect, it } from 'vitest';
import {
  bucketRef,
  planIsNudgeable,
  shouldNudgeOutside,
  shouldNudgePullingUp,
  squadOutsideCount,
  squadPullingUpCount,
} from './squad-signals.policy.js';

const now = new Date('2026-11-03T12:00:00Z');
const H = 3_600_000;

describe('squad pulling up', () => {
  const squad = new Set(['a', 'b', 'c', 'd']);
  it('counts only the viewer’s squad among seat holders who share activity, never the viewer', () => {
    expect(
      squadPullingUpCount({
        viewerId: 'me',
        viewerSquad: squad,
        sharingSeatHolders: ['a', 'b', 'stranger', 'me', 'c'],
      }),
    ).toBe(3);
  });
  it('needs three and is skipped when the viewer already holds a seat', () => {
    expect(shouldNudgePullingUp(3, false)).toBe(true);
    expect(shouldNudgePullingUp(2, false)).toBe(false);
    expect(shouldNudgePullingUp(5, true)).toBe(false);
  });
  it('only nudges about live plans starting within the next day', () => {
    const plan = { status: 'published', held: false, startsAt: new Date(now.getTime() + 5 * H) };
    expect(planIsNudgeable(plan, now)).toBe(true);
    expect(planIsNudgeable({ ...plan, held: true }, now)).toBe(false);
    expect(planIsNudgeable({ ...plan, status: 'cancelled' }, now)).toBe(false);
    expect(planIsNudgeable({ ...plan, startsAt: new Date(now.getTime() - H) }, now)).toBe(false);
    expect(planIsNudgeable({ ...plan, startsAt: new Date(now.getTime() + 25 * H) }, now)).toBe(
      false,
    );
  });
});

describe('squad outside', () => {
  it('counts distinct squad members who checked in, needs two, skips people already out', () => {
    const count = squadOutsideCount({
      viewerId: 'me',
      viewerSquad: new Set(['a', 'b']),
      sharingRecentlyCheckedIn: ['a', 'a', 'b', 'stranger', 'me'],
    });
    expect(count).toBe(2);
    expect(shouldNudgeOutside(count, false)).toBe(true);
    expect(shouldNudgeOutside(1, false)).toBe(false);
    expect(shouldNudgeOutside(count, true)).toBe(false);
  });
});

describe('bucketRef', () => {
  it('is a stable UUID per name', () => {
    const a = bucketRef('squad-outside:2026-11-03');
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(bucketRef('squad-outside:2026-11-03')).toBe(a);
    expect(bucketRef('squad-outside:2026-11-04')).not.toBe(a);
  });
});
