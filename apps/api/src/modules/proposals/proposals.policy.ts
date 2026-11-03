import { LIMITS } from '@touchgrass/shared';

const P = LIMITS.proposals;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export type ProposalReason =
  | 'PROPOSAL_CLOSED'
  | 'NEEDS_TIME_AND_PLACE'
  | 'NOT_HOST'
  | 'TOO_MANY_OPTIONS'
  | 'BAD_DEADLINE'
  | 'TIME_PASSED';

export interface ProposalFacts {
  status: 'open' | 'locked' | 'cancelled';
  deadline: Date;
  creatorId: string;
}

/** Voting and suggesting stay open until the deadline. */
export function isVotingOpen(p: ProposalFacts, now: Date): boolean {
  return p.status === 'open' && now < p.deadline;
}

/** The creator can lock any time while open (even after the deadline, when auto-lock is off). */
export function lockBlock(p: ProposalFacts, userId: string): ProposalReason | null {
  if (p.creatorId !== userId) return 'NOT_HOST';
  if (p.status !== 'open') return 'PROPOSAL_CLOSED';
  return null;
}

export function deadlineBlock(deadline: Date, now: Date): ProposalReason | null {
  const ms = deadline.getTime() - now.getTime();
  return ms < P.minDeadlineMinutes * MINUTE_MS || ms > P.maxDeadlineDays * DAY_MS
    ? 'BAD_DEADLINE'
    : null;
}

/** A time option has to be in the future (and within the plot horizon) when suggested. */
export function timeOptionBlock(startsAt: Date, now: Date): ProposalReason | null {
  if (startsAt <= now) return 'TIME_PASSED';
  if (startsAt.getTime() - now.getTime() > LIMITS.event.maxDaysAhead * DAY_MS) return 'TIME_PASSED';
  return null;
}
