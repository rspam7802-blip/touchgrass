import { LIMITS } from '@touchgrass/shared';

export type FeedbackBlock = 'NOT_ATTENDED' | 'NOT_YET' | 'FEEDBACK_CLOSED' | 'HOST';

/** Pure rule (F-AFT-02): people who checked in rate a finished plan for two weeks; hosts never rate themselves. */
export function feedbackBlock(
  viewer: { checkedIn: boolean; isHost: boolean },
  event: { status: string; endsAt: Date },
  now: Date,
): FeedbackBlock | null {
  if (viewer.isHost) return 'HOST';
  if (!viewer.checkedIn) return 'NOT_ATTENDED';
  if (event.status === 'cancelled') return 'FEEDBACK_CLOSED';
  if (now < event.endsAt) return 'NOT_YET';
  if (now.getTime() > event.endsAt.getTime() + LIMITS.after.feedbackWindowDays * 86_400_000)
    return 'FEEDBACK_CLOSED';
  return null;
}

export function feedbackOpenUntil(endsAt: Date): Date {
  return new Date(endsAt.getTime() + LIMITS.after.feedbackWindowDays * 86_400_000);
}

/** Tag counts, most common first (ties alphabetically). */
export function tally(lists: string[][], top = 10): { tag: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const list of lists) for (const t of list) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, top);
}
