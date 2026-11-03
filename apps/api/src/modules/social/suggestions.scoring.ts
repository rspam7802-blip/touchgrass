import type { SuggestionReason } from '@touchgrass/shared';

/** Transparent, config-driven weights (tune without touching the algorithm). */
export const SUGGESTION_WEIGHTS = {
  mutualFriend: 3,
  contact: 5,
  sharedInterest: 1,
  sharedEvent: 4,
  /** Diminishing returns: each extra mutual counts a little less than the last. */
  mutualCap: 10,
} as const;

export interface SuggestionSignals {
  mutualFriends: number;
  inContacts: boolean;
  sharedInterests: number;
  sharedEvents: number;
}

export function scoreSuggestion(
  s: SuggestionSignals,
  w: typeof SUGGESTION_WEIGHTS = SUGGESTION_WEIGHTS,
): number {
  const mutual = Math.min(s.mutualFriends, w.mutualCap);
  const mutualScore = w.mutualFriend * (mutual > 0 ? 1 + Math.log2(mutual) : 0);
  return (
    Math.round(
      (mutualScore +
        (s.inContacts ? w.contact : 0) +
        w.sharedInterest * s.sharedInterests +
        w.sharedEvent * s.sharedEvents) *
        100,
    ) / 100
  );
}

export function suggestionReasons(s: SuggestionSignals): SuggestionReason[] {
  const reasons: SuggestionReason[] = [];
  if (s.inContacts) reasons.push('contact');
  if (s.mutualFriends > 0) reasons.push('mutual_friends');
  if (s.sharedEvents > 0) reasons.push('shared_events');
  if (s.sharedInterests > 0) reasons.push('shared_interests');
  return reasons;
}

/**
 * Interest-only matches must also share at least two interests, so suggestions stay meaningful and never
 * look like random matching (F-SOC-03: no swiping, no random matching).
 */
export function isMeaningful(s: SuggestionSignals): boolean {
  return s.inContacts || s.mutualFriends > 0 || s.sharedEvents > 0 || s.sharedInterests >= 2;
}
