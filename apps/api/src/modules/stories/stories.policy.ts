import type { StoryAudience } from '@touchgrass/shared';

export interface StoryFacts {
  authorId: string;
  audience: StoryAudience;
  status: 'live' | 'removed';
  heldAt: Date | null;
  expiresAt: Date;
}

export interface StoryViewerFacts {
  viewerId: string;
  /** Either side blocked the other. */
  blocked: boolean;
  /** The author is in the viewer's squad. */
  inSquad: boolean;
  /** The author shares at least one squad member with the viewer. */
  friendOfFriend: boolean;
  /** The author's account is active (not suspended, banned or deleting). */
  authorActive: boolean;
}

/**
 * Who sees a story (Phase 13). Removed and expired stories are seen by nobody; the author always sees their
 * own live story (held or not); everyone else needs an active author, no block either way, no hold, and to be
 * in the chosen audience.
 */
export function canViewStory(story: StoryFacts, viewer: StoryViewerFacts, now: Date): boolean {
  if (story.status !== 'live') return false;
  if (story.expiresAt.getTime() <= now.getTime()) return false;
  if (viewer.viewerId === story.authorId) return true;
  if (viewer.blocked || !viewer.authorActive) return false;
  if (story.heldAt !== null) return false;
  if (viewer.inSquad) return true;
  return story.audience === 'squad_fof' && viewer.friendOfFriend;
}

/** Only the author sees who viewed and liked a story. */
export function canSeeStoryStats(story: Pick<StoryFacts, 'authorId'>, viewerId: string): boolean {
  return story.authorId === viewerId;
}

/** Likes are for other people's stories the viewer can see. */
export function canLikeStory(story: StoryFacts, viewer: StoryViewerFacts, now: Date): boolean {
  return viewer.viewerId !== story.authorId && canViewStory(story, viewer, now);
}

export interface TrayAuthor {
  authorId: string;
  mine: boolean;
  unseen: boolean;
  latestAt: Date;
}

/** Tray order: your own first, then people with something new, then the rest; newest first within each. */
export function trayOrder<T extends TrayAuthor>(entries: T[]): T[] {
  const rank = (e: TrayAuthor): number => (e.mine ? 0 : e.unseen ? 1 : 2);
  return [...entries].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      b.latestAt.getTime() - a.latestAt.getTime() ||
      a.authorId.localeCompare(b.authorId),
  );
}
