import { z } from 'zod';
import { LIMITS } from '../constants';
import { PersonCard } from './social';

/** Public questions and chatter on a plan, for anyone who can see it (D-156). */
export const EventComment = z.object({
  id: z.uuid(),
  author: PersonCard,
  body: z.string(),
  createdAt: z.iso.datetime(),
  mine: z.boolean(),
  /** Written by one of the plan's hosts. */
  fromHost: z.boolean(),
  /** Your comment tripped the text filter: only you see it until it's reviewed (F-SAF-06). */
  held: z.boolean(),
  /** You wrote it, or you host the plan. */
  canDelete: z.boolean(),
});
export type EventComment = z.infer<typeof EventComment>;

export const EventCommentPage = z.object({
  items: z.array(EventComment),
  nextCursor: z.string().nullable(),
  /** The plan takes comments (not cancelled) and you may post. */
  canComment: z.boolean(),
});
export type EventCommentPage = z.infer<typeof EventCommentPage>;

export const EventCommentsQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type EventCommentsQuery = z.infer<typeof EventCommentsQuery>;

export const PostCommentBody = z.object({
  body: z.string().trim().min(1).max(LIMITS.comments.maxLength),
});
export type PostCommentBody = z.infer<typeof PostCommentBody>;
