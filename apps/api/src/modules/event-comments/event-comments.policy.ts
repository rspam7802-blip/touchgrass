/**
 * Comments on plans (D-156). Reading follows the plan: whoever can see the plan sees its comments, minus
 * people blocked either way and other people's held comments. Posting needs a live plan (published or
 * just finished, not cancelled or draft). Authors delete their own; any host role deletes on its plan.
 */
export function canComment(event: { status: string }, canView: boolean): boolean {
  return canView && (event.status === 'published' || event.status === 'completed');
}

export function commentVisibleTo(
  comment: { authorId: string; heldAt: Date | null; status: 'visible' | 'removed' },
  viewerId: string,
  blocked: ReadonlySet<string>,
): boolean {
  if (comment.status !== 'visible') return false;
  if (comment.authorId === viewerId) return true;
  if (blocked.has(comment.authorId)) return false;
  return comment.heldAt === null;
}

export function canDeleteComment(
  comment: { authorId: string },
  viewerId: string,
  viewerHosts: boolean,
): boolean {
  return comment.authorId === viewerId || viewerHosts;
}
