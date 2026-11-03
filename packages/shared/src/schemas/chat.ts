import { z } from 'zod';
import { LIMITS } from '../constants';
import { LocalizedName } from './catalog';
import { MediaVariants } from './media';
import { PersonCard } from './social';

const C = LIMITS.chat;

export const ConversationKind = z.enum(['direct', 'event', 'crew']);
export type ConversationKind = z.infer<typeof ConversationKind>;

/** Where the viewer stands: a normal chat, or a DM request they sent / received (F-CHT-01). */
export const ConversationState = z.enum(['active', 'request_sent', 'request_received']);
export type ConversationState = z.infer<typeof ConversationState>;

export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙌'] as const;
export const Reaction = z.enum(REACTIONS);
export type Reaction = z.infer<typeof Reaction>;

export const MessageKind = z.enum(['text', 'image', 'system', 'poll']);
export type MessageKind = z.infer<typeof MessageKind>;

/** System lines are rendered by the client from their type + data (so they follow the reader's language). */
export const SystemMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chat_opened'), prompt: LocalizedName.nullable() }),
  z.object({ type: z.literal('icebreaker'), prompt: LocalizedName }),
  z.object({ type: z.literal('request_accepted') }),
]);
export type SystemMessage = z.infer<typeof SystemMessage>;

export const PollOptionView = z.object({
  id: z.uuid(),
  text: z.string(),
  votes: z.number().int(),
  mine: z.boolean(),
  /** Empty for anonymous polls. */
  voters: z.array(PersonCard),
});
export const PollView = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  question: z.string(),
  multi: z.boolean(),
  anonymous: z.boolean(),
  closesAt: z.iso.datetime().nullable(),
  closed: z.boolean(),
  options: z.array(PollOptionView),
  totalVoters: z.number().int(),
});
export type PollView = z.infer<typeof PollView>;

export const ReplyPreview = z.object({
  id: z.uuid(),
  senderName: z.string().nullable(),
  /** Short excerpt; null when the original was deleted. */
  excerpt: z.string().nullable(),
});

export const Message = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  /** Null for system messages, and for senders the viewer has blocked or who deleted their account. */
  sender: PersonCard.nullable(),
  mine: z.boolean(),
  kind: MessageKind,
  body: z.string().nullable(),
  image: MediaVariants.nullable(),
  replyTo: ReplyPreview.nullable(),
  reactions: z.array(z.object({ emoji: Reaction, count: z.number().int(), mine: z.boolean() })),
  poll: PollView.nullable(),
  system: SystemMessage.nullable(),
  deleted: z.boolean(),
  /** Your own message, held for review by the text filter: nobody else sees it yet (F-SAF-06). */
  held: z.boolean(),
  clientId: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type Message = z.infer<typeof Message>;

export const MessagePage = z.object({
  /** Newest first. */
  items: z.array(Message),
  /** Cursor for older messages. */
  nextCursor: z.string().nullable(),
  /** Latest message each other member has read (only for members who share read receipts). */
  readBy: z.array(z.object({ userId: z.uuid(), messageId: z.uuid() })),
});
export type MessagePage = z.infer<typeof MessagePage>;

export const ConversationSummary = z.object({
  id: z.uuid(),
  kind: ConversationKind,
  state: ConversationState,
  title: z.string(),
  avatar: MediaVariants.nullable(),
  /** The other person, for direct chats. */
  peer: PersonCard.nullable(),
  eventId: z.uuid().nullable(),
  lastMessage: z
    .object({
      senderName: z.string().nullable(),
      kind: MessageKind,
      excerpt: z.string().nullable(),
      createdAt: z.iso.datetime(),
    })
    .nullable(),
  unreadCount: z.number().int(),
  muted: z.boolean(),
  /** Event chats are read-only after they close; DM requests until accepted (for the receiver). */
  readOnly: z.boolean(),
  /** Hosts can start polls in their plan's chat. */
  canCreatePoll: z.boolean(),
  /** Event chats open 24 h before the start. */
  opensAt: z.iso.datetime().nullable(),
  closesAt: z.iso.datetime().nullable(),
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const ConversationList = z.object({
  items: z.array(ConversationSummary),
  nextCursor: z.string().nullable(),
});
export type ConversationList = z.infer<typeof ConversationList>;

export const ConversationListQuery = z.object({
  filter: z.enum(['all', 'requests']).default('all'),
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export type ConversationListQuery = z.infer<typeof ConversationListQuery>;

export const MessagePageQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type MessagePageQuery = z.infer<typeof MessagePageQuery>;

export const StartDirectBody = z.object({ userId: z.uuid() });
export type StartDirectBody = z.infer<typeof StartDirectBody>;
export const RespondRequestBody = z.object({ accept: z.boolean() });
export type RespondRequestBody = z.infer<typeof RespondRequestBody>;

export const SendMessageBody = z
  .object({
    /** Client-generated id; resending the same id never creates a second message (offline queue). */
    clientId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    kind: z.enum(['text', 'image']).default('text'),
    body: z.string().trim().max(C.maxMessageLength).optional(),
    mediaId: z.uuid().optional(),
    replyToId: z.uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'text' && !v.body)
      ctx.addIssue({ code: 'custom', path: ['body'], message: 'Say something' });
    if (v.kind === 'image' && !v.mediaId)
      ctx.addIssue({ code: 'custom', path: ['mediaId'], message: 'Attach an image' });
  });
export type SendMessageBody = z.infer<typeof SendMessageBody>;

export const ReadBody = z.object({ messageId: z.uuid() });
export type ReadBody = z.infer<typeof ReadBody>;
export const MuteBody = z.object({ duration: z.enum(['off', 'hour', 'day', 'week', 'forever']) });
export type MuteBody = z.infer<typeof MuteBody>;
export const ReactBody = z.object({ emoji: Reaction });
export type ReactBody = z.infer<typeof ReactBody>;
export const DeleteMessageQuery = z.object({ scope: z.enum(['me', 'everyone']).default('me') });
export type DeleteMessageQuery = z.infer<typeof DeleteMessageQuery>;

export const CreatePollBody = z
  .object({
    question: z.string().trim().min(3).max(200),
    options: z.array(z.string().trim().min(1).max(80)).min(2).max(10),
    multi: z.boolean().default(false),
    anonymous: z.boolean().default(false),
    closesAt: z.iso.datetime().nullable().default(null),
  })
  .refine((p) => new Set(p.options.map((o) => o.toLowerCase())).size === p.options.length, {
    message: 'Options must be different',
    path: ['options'],
  });
export type CreatePollBody = z.infer<typeof CreatePollBody>;
export const VoteBody = z.object({ optionIds: z.array(z.uuid()).max(10) });
export type VoteBody = z.infer<typeof VoteBody>;

// ---------- at the event (F-ATE-01..03) ----------

export const IcebreakerCategory = z.enum(['light', 'deep', 'playful', 'local']);
export const IcebreakerCard = z.object({
  id: z.uuid(),
  prompt: LocalizedName,
  category: IcebreakerCategory,
  active: z.boolean(),
});
export type IcebreakerCard = z.infer<typeof IcebreakerCard>;
export const IcebreakerDeck = z.object({ items: z.array(IcebreakerCard) });
export type IcebreakerDeck = z.infer<typeof IcebreakerDeck>;
export const UpsertIcebreakerBody = z.object({
  prompt: LocalizedName,
  category: IcebreakerCategory,
  active: z.boolean().default(true),
});
export type UpsertIcebreakerBody = z.infer<typeof UpsertIcebreakerBody>;
export const PushIcebreakerBody = z.object({ cardId: z.uuid() });
export type PushIcebreakerBody = z.infer<typeof PushIcebreakerBody>;

/** Find-your-group signal: colour + icon unique among overlapping plans nearby (F-ATE-02). */
export const EventSignal = z.object({
  color: z.string().regex(/^#[0-9A-F]{6}$/),
  icon: z.string(),
  /** Machine names for the colour and icon, for screen readers (`ate.colors.*`, `ate.icons.*`). */
  colorName: z.string(),
  iconName: z.string(),
  availableFrom: z.iso.datetime(),
});
export type EventSignal = z.infer<typeof EventSignal>;

export const NewcomerList = z.object({
  items: z.array(
    z.object({
      person: PersonCard,
      welcomed: z.boolean(),
      welcomedBy: z.string().nullable(),
      checkedIn: z.boolean(),
    }),
  ),
});
export type NewcomerList = z.infer<typeof NewcomerList>;
export const WelcomeBody = z.object({ welcomed: z.boolean() });
export type WelcomeBody = z.infer<typeof WelcomeBody>;
