/**
 * Who may ping someone who is free now (F-ENG-01, Phase 13). Pure, so each rule is unit-tested.
 * A refusal that would reveal a relationship (blocks, not in the squad) reads as "not found".
 */
export type PingRefusal = 'self' | 'not_found' | 'not_free';

export function pingRefusal(input: {
  fromId: string;
  toId: string;
  inSquad: boolean;
  blockedEitherWay: boolean;
  /** When the target's "I'm free" ends, or null if they never said they're free. */
  targetFreeUntil: Date | null;
  now: Date;
}): PingRefusal | null {
  if (input.fromId === input.toId) return 'self';
  if (input.blockedEitherWay || !input.inSquad) return 'not_found';
  if (!input.targetFreeUntil || input.targetFreeUntil <= input.now) return 'not_free';
  return null;
}

/** One ping per pair per this many seconds, so a ping stays a nudge and never becomes spam. */
export const PING_PAIR_WINDOW_SECONDS = 30 * 60;

export function pingThrottleKey(fromId: string, toId: string): string {
  return `ping:${fromId}:${toId}`;
}
