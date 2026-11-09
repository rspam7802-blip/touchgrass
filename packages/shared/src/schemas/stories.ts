import { z } from 'zod';
import { LIMITS } from '../constants';
import { MediaVariants } from './media';
import { PersonCard } from './social';

const S = LIMITS.stories;

/** Who can see a story, chosen per story: your squad, or your squad and their squads. */
export const StoryAudience = z.enum(['squad', 'squad_fof']);
export type StoryAudience = z.infer<typeof StoryAudience>;

export const PostStoryBody = z.object({
  mediaId: z.uuid(),
  caption: z.string().trim().max(S.captionMaxLength).default(''),
  audience: StoryAudience,
});
export type PostStoryBody = z.infer<typeof PostStoryBody>;

export const Story = z.object({
  id: z.uuid(),
  /** For a video story, the poster frame. */
  image: MediaVariants,
  /** A video story's playable file (H.264/AAC MP4, re-encoded on our servers) and its length. */
  video: z
    .object({ url: z.url(), durationMs: z.number().int().positive() })
    .nullable()
    .default(null),
  caption: z.string(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  /** The viewer has opened it before. */
  seen: z.boolean(),
  liked: z.boolean(),
  mine: z.boolean(),
  /** Only for your own stories. */
  audience: StoryAudience.nullable(),
  /** Your caption tripped the text filter: nobody else sees the story until it's reviewed (F-SAF-06). */
  held: z.boolean(),
  /** Only for your own stories: how many people opened it and how many liked it. */
  viewCount: z.number().int().nullable(),
  likeCount: z.number().int().nullable(),
});
export type Story = z.infer<typeof Story>;

export const StoryTrayEntry = z.object({
  person: PersonCard,
  mine: z.boolean(),
  count: z.number().int(),
  /** At least one of their stories is new to the viewer. */
  unseen: z.boolean(),
  latestAt: z.iso.datetime(),
});
export type StoryTrayEntry = z.infer<typeof StoryTrayEntry>;

/** People with live stories the viewer may see: you first, then unseen, then seen (newest first). */
export const StoryTray = z.object({ items: z.array(StoryTrayEntry) });
export type StoryTray = z.infer<typeof StoryTray>;

/** One person's live stories, oldest first (the order they play in). */
export const PersonStories = z.object({ person: PersonCard, items: z.array(Story) });
export type PersonStories = z.infer<typeof PersonStories>;

export const StoryViewer = z.object({
  person: PersonCard,
  liked: z.boolean(),
  viewedAt: z.iso.datetime(),
});
export type StoryViewer = z.infer<typeof StoryViewer>;

export const StoryViewersPage = z.object({
  items: z.array(StoryViewer),
  nextCursor: z.string().nullable(),
});
export type StoryViewersPage = z.infer<typeof StoryViewersPage>;

export const StoryViewersQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type StoryViewersQuery = z.infer<typeof StoryViewersQuery>;
