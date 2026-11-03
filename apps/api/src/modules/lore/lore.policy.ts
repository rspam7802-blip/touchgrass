import type { LoreVisibility } from '@touchgrass/shared';

export interface LoreViewer {
  /** Checked in at the plan, or hosted it. */
  attended: boolean;
  isHost: boolean;
  /** Squad of someone who attended (for "friends of attendees" albums). */
  squadOfAttendee: boolean;
}

/** Pure rules (F-AFT-04). Albums open once a plan has started and never for cancelled or draft plans. */
export function loreAccess(
  viewer: LoreViewer,
  event: { status: string; startsAt: Date },
  visibility: LoreVisibility,
  now: Date,
): { view: boolean; add: boolean; manage: boolean } {
  const open =
    (event.status === 'published' || event.status === 'completed') && now >= event.startsAt;
  if (!open) return { view: false, add: false, manage: false };
  const insider = viewer.attended || viewer.isHost;
  return {
    view: insider || (visibility === 'friends_of_attendees' && viewer.squadOfAttendee),
    add: insider,
    manage: viewer.isHost,
  };
}

/** The items a cover collage is made of, as a stable key (the collage is redrawn only when it changes). */
export function coverSource(itemIds: string[]): string {
  return itemIds.join(',');
}
