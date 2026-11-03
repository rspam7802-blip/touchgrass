import type {
  CrewJoinPolicy,
  CrewMemberActionBody,
  CrewMembershipBody,
  CrewMemberStatus,
  CrewRole,
} from '@touchgrass/shared';

export interface Membership {
  role: CrewRole;
  status: CrewMemberStatus;
}

export interface CrewFacts {
  status: 'active' | 'archived';
  joinPolicy: CrewJoinPolicy;
  /** Held for review by the text filter (F-SAF-06): members only until released. */
  heldAt?: Date | null;
}

/** Stable reason codes (shown through `events.reasons.*`). */
export type CrewReason =
  | 'NOT_CREW_MEMBER'
  | 'CREW_ADMIN_ONLY'
  | 'LAST_ADMIN'
  | 'CREW_FULL'
  | 'CREW_INVITE_ONLY'
  | 'ALREADY_IN'
  | 'NOT_INVITED'
  | 'NOT_FOUND';

/** Open crews show up for everyone; invite-only crews only for people already connected to them. */
export function canSeeCrew(crew: CrewFacts, m: Membership | null): boolean {
  if (crew.status !== 'active' || crew.heldAt) return m?.status === 'active';
  return crew.joinPolicy === 'request' || m !== null;
}

export function isActive(m: Membership | null): boolean {
  return m?.status === 'active';
}

export function canManage(m: Membership | null): boolean {
  return m?.status === 'active' && m.role === 'admin';
}

export type MembershipChange =
  | { kind: 'insert'; status: 'requested' }
  | { kind: 'activate' }
  | { kind: 'delete' }
  | { kind: 'none' }
  | { kind: 'error'; reason: CrewReason };

/**
 * What the person's own join/accept/decline/leave does. `admins` and `activeCount` let it refuse leaving as the
 * last admin of a crew that still has members, and joining a full crew.
 */
export function membershipChange(
  policy: CrewJoinPolicy,
  m: Membership | null,
  action: CrewMembershipBody['action'],
  ctx: { admins: number; activeCount: number; maxMembers: number },
): MembershipChange {
  switch (action) {
    case 'join':
      if (m?.status === 'active') return { kind: 'error', reason: 'ALREADY_IN' };
      if (m?.status === 'requested') return { kind: 'none' };
      if (ctx.activeCount >= ctx.maxMembers) return { kind: 'error', reason: 'CREW_FULL' };
      if (m?.status === 'invited') return { kind: 'activate' };
      if (policy === 'invite_only') return { kind: 'error', reason: 'CREW_INVITE_ONLY' };
      return { kind: 'insert', status: 'requested' };
    case 'accept':
      if (m?.status !== 'invited') return { kind: 'error', reason: 'NOT_INVITED' };
      if (ctx.activeCount >= ctx.maxMembers) return { kind: 'error', reason: 'CREW_FULL' };
      return { kind: 'activate' };
    case 'decline':
      return m && m.status !== 'active'
        ? { kind: 'delete' }
        : { kind: 'error', reason: 'NOT_INVITED' };
    case 'leave':
      if (m?.status !== 'active') return { kind: 'error', reason: 'NOT_CREW_MEMBER' };
      if (m.role === 'admin' && ctx.admins <= 1 && ctx.activeCount > 1)
        return { kind: 'error', reason: 'LAST_ADMIN' };
      return { kind: 'delete' };
  }
}

export type MemberActionResult =
  | { kind: 'activate' }
  | { kind: 'delete' }
  | { kind: 'role'; role: CrewRole }
  | { kind: 'error'; reason: CrewReason };

/** What an admin's action on someone else does. */
export function memberAction(
  actor: Membership | null,
  actorIsTarget: boolean,
  target: Membership | null,
  action: CrewMemberActionBody['action'],
  ctx: { admins: number; activeCount: number; maxMembers: number },
): MemberActionResult {
  if (!canManage(actor)) return { kind: 'error', reason: 'CREW_ADMIN_ONLY' };
  if (!target) return { kind: 'error', reason: 'NOT_FOUND' };
  switch (action) {
    case 'approve':
      if (target.status !== 'requested') return { kind: 'error', reason: 'NOT_FOUND' };
      if (ctx.activeCount >= ctx.maxMembers) return { kind: 'error', reason: 'CREW_FULL' };
      return { kind: 'activate' };
    case 'decline':
      return target.status === 'requested'
        ? { kind: 'delete' }
        : { kind: 'error', reason: 'NOT_FOUND' };
    case 'remove':
      // Leaving yourself goes through "leave", which protects the last admin.
      if (actorIsTarget || target.status === 'requested')
        return { kind: 'error', reason: 'NOT_FOUND' };
      return { kind: 'delete' };
    case 'make_admin':
      return target.status === 'active' && target.role === 'member'
        ? { kind: 'role', role: 'admin' }
        : { kind: 'error', reason: 'NOT_FOUND' };
    case 'make_member':
      if (target.status !== 'active' || target.role !== 'admin')
        return { kind: 'error', reason: 'NOT_FOUND' };
      if (ctx.admins <= 1) return { kind: 'error', reason: 'LAST_ADMIN' };
      return { kind: 'role', role: 'member' };
  }
}

/** Upcoming sessions to create: occurrences from the rule that don't have a session yet. */
export function missingOccurrences(occurrences: Date[], existing: ReadonlySet<number>): Date[] {
  return occurrences.filter((o) => !existing.has(o.getTime()));
}
