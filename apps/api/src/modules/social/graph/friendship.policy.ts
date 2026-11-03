import type { RelationshipStatus } from '@touchgrass/shared';

export type FriendshipRowStatus = 'pending' | 'accepted' | 'declined' | 'cancelled';
export interface FriendshipState {
  status: FriendshipRowStatus;
  requesterId: string;
  respondedAt: Date | null;
}

/** Canonical pair ordering: one row per unordered pair. */
export function orderedPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export function relationshipFrom(
  viewerId: string,
  row: FriendshipState | null,
): RelationshipStatus {
  if (!row) return 'none';
  if (row.status === 'accepted') return 'squad';
  if (row.status === 'pending')
    return row.requesterId === viewerId ? 'request_sent' : 'request_received';
  return 'none';
}

/** How long a declined request silently stays "sent" for the requester, so declines are not re-spammed. */
export const DECLINE_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export type RequestOutcome =
  | { action: 'none'; relationship: RelationshipStatus }
  | { action: 'create_or_reopen' }
  | { action: 'accept_reverse' };

/**
 * What a new squad request from `fromId` does given the pair's current row (F-SOC-02):
 * already squad → no-op; they already asked you → mutual accept; you already asked → idempotent;
 * they declined you recently → silently stays "sent"; otherwise a fresh pending request.
 */
export function decideRequest(
  fromId: string,
  row: FriendshipState | null,
  now: Date,
): RequestOutcome {
  if (!row) return { action: 'create_or_reopen' };
  switch (row.status) {
    case 'accepted':
      return { action: 'none', relationship: 'squad' };
    case 'pending':
      return row.requesterId === fromId
        ? { action: 'none', relationship: 'request_sent' }
        : { action: 'accept_reverse' };
    case 'declined':
      if (
        row.requesterId === fromId &&
        row.respondedAt &&
        now.getTime() - row.respondedAt.getTime() < DECLINE_COOLDOWN_MS
      ) {
        return { action: 'none', relationship: 'request_sent' };
      }
      return { action: 'create_or_reopen' };
    case 'cancelled':
      return { action: 'create_or_reopen' };
  }
}
