import type { ProfileVisibility, UserStatus } from '@touchgrass/shared';

/** How the viewer relates to the profile owner, resolved by the social graph. */
export type Relationship = 'self' | 'squad' | 'friend_of_friend' | 'none';

export interface ProfileViewContext {
  relationship: Relationship;
  blocked: boolean;
  targetStatus: UserStatus;
  visibility: ProfileVisibility;
}

export type ProfileAccess = 'full' | 'limited' | 'none';

/**
 * Profile visibility (F-ACC-05, F-SOC-05). Blocks hide both people from each other entirely; non-active
 * accounts are invisible; otherwise the owner's visibility setting decides between the full and the limited card.
 */
export function profileAccess(ctx: ProfileViewContext): ProfileAccess {
  if (ctx.relationship === 'self') return 'full';
  if (ctx.blocked) return 'none';
  if (ctx.targetStatus !== 'active') return 'none';
  switch (ctx.visibility) {
    case 'everyone':
      return 'full';
    case 'friends_of_friends':
      return ctx.relationship === 'squad' || ctx.relationship === 'friend_of_friend'
        ? 'full'
        : 'limited';
    case 'squad_only':
      return ctx.relationship === 'squad' ? 'full' : 'limited';
  }
}
