import { createHash } from 'node:crypto';
import { LIMITS } from '@touchgrass/shared';

const N = LIMITS.notifications;

/**
 * "N of your squad are pulling up" (Phase 13, from the product brand notes): how many of the viewer's squad hold a
 * seat at the plan, counting only people who share their activity, never the viewer.
 */
export function squadPullingUpCount(input: {
  viewerId: string;
  viewerSquad: ReadonlySet<string>;
  /** People holding a seat (going or checked in) who share their activity with their squad. */
  sharingSeatHolders: readonly string[];
}): number {
  return input.sharingSeatHolders.filter((id) => id !== input.viewerId && input.viewerSquad.has(id))
    .length;
}

/** Whether a plan is worth nudging about now: live, visible to the public eye, starting within the next day. */
export function planIsNudgeable(
  plan: { status: string; held: boolean; startsAt: Date },
  now: Date,
): boolean {
  const ms = plan.startsAt.getTime() - now.getTime();
  return plan.status === 'published' && !plan.held && ms > 0 && ms <= N.reminderLongMs;
}

export function shouldNudgePullingUp(count: number, viewerHoldsSeat: boolean): boolean {
  return !viewerHoldsSeat && count >= N.squadPullingUpMin;
}

/** "Your squad is outside": squad members (sharing activity) who checked in somewhere in the recent window. */
export function squadOutsideCount(input: {
  viewerId: string;
  viewerSquad: ReadonlySet<string>;
  sharingRecentlyCheckedIn: readonly string[];
}): number {
  return new Set(
    input.sharingRecentlyCheckedIn.filter(
      (id) => id !== input.viewerId && input.viewerSquad.has(id),
    ),
  ).size;
}

export function shouldNudgeOutside(count: number, viewerCheckedInRecently: boolean): boolean {
  return !viewerCheckedInRecently && count >= N.squadOutsideMin;
}

/**
 * `reminder_log` keys are UUIDs; buckets like "squad-outside:2026-11-03" become a stable name-based UUID
 * (version 5 layout over SHA-1), so "once per evening" and "once per hour" need no new table.
 */
export function bucketRef(name: string): string {
  const h = createHash('sha1').update(`touchgrass:${name}`).digest();
  h[6] = ((h[6] ?? 0) & 0x0f) | 0x50;
  h[8] = ((h[8] ?? 0) & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}
