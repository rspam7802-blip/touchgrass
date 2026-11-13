import {
  genderOnly,
  type EventStatus,
  type EventVisibility,
  type Gender,
  type HostRole,
  type JoinRequestStatus,
  LIMITS,
  type RsvpStatus,
} from '@touchgrass/shared';
import { AppError } from '../../common/errors/app-error.js';
import type { Relationship } from '../profiles/profile.policy.js';

export interface EventFacts {
  status: EventStatus;
  visibility: EventVisibility;
  startsAt: Date;
  endsAt: Date;
  capacity: number;
  balancedMaxSharePct: number | null;
  mystery: boolean;
  mysteryRevealMinutesBefore: number;
  /** Held for review by the text filter (F-SAF-06). */
  held?: boolean;
}

export interface ViewerFacts {
  hostRole: HostRole | null;
  invited: boolean;
  rsvp: RsvpStatus | null;
  /** Closest graph distance between the viewer and any host. */
  relationshipToHosts: Relationship;
  blockedWithHost: boolean;
  gender: Gender | null;
  verified: boolean;
  /** Their request to join a private plan, if any (D-179). */
  joinRequest?: JoinRequestStatus | null;
}

export type IneligibleReason =
  | 'CLOSED'
  | 'BLOCKED'
  | 'NOT_INVITED'
  | 'WOMEN_ONLY'
  | 'MEN_ONLY'
  | 'VERIFICATION_REQUIRED'
  | 'APPROVAL_REQUIRED'
  | 'HOST';
export type GenderBucket = 'woman' | 'man' | 'other';

const HAS_SEAT: readonly RsvpStatus[] = ['going', 'checked_in'];

export function holdsSeat(status: RsvpStatus | null): boolean {
  return status !== null && HAS_SEAT.includes(status);
}

/** Women-only and men-only plans are for people whose gender a reviewer has verified. */
export function matchesGenderOnly(
  visibility: EventVisibility,
  who: { gender: Gender | null; verified: boolean },
): boolean {
  const only = genderOnly(visibility);
  return only === null || (who.verified && who.gender === only);
}

/**
 * Who can see an event (F-EVT-03, F-SAF-03). Hosts always; plans held for review and blocks with any host hide
 * it; drafts are host-only;
 * an invite or an existing RSVP opens invite-only and friends-of-friends events.
 */
export function canViewEvent(v: ViewerFacts, e: EventFacts): boolean {
  if (v.hostRole) return true;
  if (e.held) return false;
  if (v.blockedWithHost) return false;
  if (e.status === 'draft') return false;
  if (genderOnly(e.visibility) !== null) return matchesGenderOnly(e.visibility, v);
  if (v.invited || (v.rsvp !== null && v.rsvp !== 'cancelled')) return true;
  switch (e.visibility) {
    // Private (`approval`) plans show their basics to everyone; the spot, guest list and chat wait.
    case 'public':
    case 'balanced':
    case 'approval':
      return true;
    case 'friends_of_friends':
      return v.relationshipToHosts === 'squad' || v.relationshipToHosts === 'friend_of_friend';
    case 'invite_only':
      return false;
    case 'women_only':
    case 'men_only':
      return matchesGenderOnly(e.visibility, v);
  }
}

/**
 * Private plans (D-179): a host has let this person in, by approving their request or inviting them, or they
 * already have a place (a seat, the waitlist or a payment hold).
 */
export function isLetIn(v: Pick<ViewerFacts, 'hostRole' | 'invited' | 'rsvp'>): boolean {
  return (
    v.hostRole !== null ||
    v.invited ||
    holdsSeat(v.rsvp) ||
    v.rsvp === 'waitlisted' ||
    v.rsvp === 'held'
  );
}

/** Whether the viewer may pull up at all; capacity and gender balance are checked separately under lock. */
export function rsvpEligibility(
  v: ViewerFacts,
  e: EventFacts,
  now: Date,
): { ok: true } | { ok: false; reason: IneligibleReason } {
  if (v.hostRole) return { ok: false, reason: 'HOST' };
  if (v.blockedWithHost) return { ok: false, reason: 'BLOCKED' };
  if (e.status !== 'published' || now.getTime() >= e.endsAt.getTime())
    return { ok: false, reason: 'CLOSED' };
  const only = genderOnly(e.visibility);
  if (only !== null && !matchesGenderOnly(e.visibility, v)) {
    return {
      ok: false,
      reason:
        v.gender === only && !v.verified
          ? 'VERIFICATION_REQUIRED'
          : only === 'woman'
            ? 'WOMEN_ONLY'
            : 'MEN_ONLY',
    };
  }
  if (!canViewEvent(v, e)) return { ok: false, reason: 'NOT_INVITED' };
  if (e.visibility === 'approval' && !isLetIn(v)) return { ok: false, reason: 'APPROVAL_REQUIRED' };
  return { ok: true };
}

/** Only verified gender counts for balanced events (F-SAF-01); everyone else shares the "other" bucket. */
export function genderBucket(gender: Gender | null, verified: boolean): GenderBucket {
  if (verified && gender === 'woman') return 'woman';
  if (verified && gender === 'man') return 'man';
  return 'other';
}

/** Balanced events: no bucket may hold more than `pct`% of capacity (each bucket, including "other"). */
export function balancedAllows(
  e: Pick<EventFacts, 'visibility' | 'capacity' | 'balancedMaxSharePct'>,
  bucketSeats: number,
  adding: number,
): boolean {
  if (e.visibility !== 'balanced' || e.balancedMaxSharePct === null) return true;
  const cap = Math.floor((e.capacity * e.balancedMaxSharePct) / 100);
  return bucketSeats + adding <= cap;
}

/** Plans whose true spot is not public: mystery plans and private (`approval`) plans. */
export function hidesSpot(e: Pick<EventFacts, 'mystery' | 'visibility'>): boolean {
  return e.mystery || e.visibility === 'approval';
}

/**
 * The true spot is shown to hosts always. A mystery spot is revealed to people going once the reveal time has
 * come (F-EVT-12); a private plan's spot only to people going (D-179).
 */
export function isLocationRevealed(
  v: Pick<ViewerFacts, 'hostRole' | 'rsvp'>,
  e: Pick<EventFacts, 'mystery' | 'visibility' | 'startsAt' | 'mysteryRevealMinutesBefore'>,
  now: Date,
): boolean {
  if (!hidesSpot(e) || v.hostRole) return true;
  if (!holdsSeat(v.rsvp)) return false;
  return !e.mystery || now.getTime() >= revealTime(e).getTime();
}

export function revealTime(e: Pick<EventFacts, 'startsAt' | 'mysteryRevealMinutesBefore'>): Date {
  return new Date(e.startsAt.getTime() - e.mysteryRevealMinutesBefore * 60_000);
}

export function checkInWindowOpen(
  e: Pick<EventFacts, 'startsAt' | 'endsAt' | 'status'>,
  now: Date,
): boolean {
  const t = now.getTime();
  const opens = e.startsAt.getTime() - LIMITS.checkIn.windowBeforeMs;
  const closes = Math.min(e.startsAt.getTime() + LIMITS.checkIn.windowAfterMs, e.endsAt.getTime());
  return e.status === 'published' && t >= opens && t <= closes;
}

/** Cancelling within 3 h of the start counts as a late cancel for reliability (F-SAF-02). */
export function isLateCancel(e: Pick<EventFacts, 'startsAt'>, now: Date): boolean {
  return e.startsAt.getTime() - now.getTime() < LIMITS.reliability.lateCancelWindowMs;
}

/** Within 6 h of the start, freed spots go to the whole waitlist at once (F-EVT-08). */
export function waitlistMode(
  e: Pick<EventFacts, 'startsAt'>,
  now: Date,
): 'sequential' | 'broadcast' {
  return e.startsAt.getTime() - now.getTime() <= LIMITS.waitlist.lastMinuteThresholdMs
    ? 'broadcast'
    : 'sequential';
}

export const MATERIAL_FIELDS = ['startsAt', 'endsAt', 'where', 'pricePaise'] as const;

/** Changes attendees must be told about (F-EVT-16). */
export function materialChanges(
  before: { startsAt: Date; endsAt: Date; locationKey: string; pricePaise: number },
  after: typeof before,
): string[] {
  const changed: string[] = [];
  if (before.startsAt.getTime() !== after.startsAt.getTime()) changed.push('startsAt');
  if (before.endsAt.getTime() !== after.endsAt.getTime()) changed.push('endsAt');
  if (before.locationKey !== after.locationKey) changed.push('location');
  if (before.pricePaise !== after.pricePaise) changed.push('price');
  return changed;
}

/** The refusal for someone a women-only or men-only plan is not for (hosting, co-hosting, +1s). */
export function genderOnlyError(
  visibility: EventVisibility,
  message = 'Women-only and men-only plans are hosted and joined by verified members of that gender',
): AppError {
  return new AppError('NOT_ELIGIBLE', message, {
    reason: genderOnly(visibility) === 'man' ? 'MEN_ONLY' : 'WOMEN_ONLY',
  });
}
