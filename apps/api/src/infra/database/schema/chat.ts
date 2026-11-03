import {
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Phase 5 tables. Owners: conversations / members / messages / reactions / hidden / client ids / polls → `chat`;
 * icebreaker cards + pushes, event signals, newcomer welcomes → `at-event`. `messages` is partitioned monthly
 * on created_at, which always equals the UUID v7 id's timestamp.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });
const timestamps = {
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
};

export interface LocalizedJson {
  en: string;
  te: string;
  hi: string;
}
export type SystemJson =
  | { type: 'chat_opened'; prompt: LocalizedJson | null }
  | { type: 'icebreaker'; prompt: LocalizedJson }
  | { type: 'request_accepted' };

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey(),
  kind: text('kind', { enum: ['direct', 'event', 'crew'] }).notNull(),
  eventId: uuid('event_id').unique(),
  crewId: uuid('crew_id').unique(),
  directKey: text('direct_key').unique(),
  createdBy: uuid('created_by'),
  lastMessageId: uuid('last_message_id'),
  lastMessageAt: ts('last_message_at'),
  ...timestamps,
});

export const conversationMembers = pgTable(
  'conversation_members',
  {
    conversationId: uuid('conversation_id').notNull(),
    userId: uuid('user_id').notNull(),
    status: text('status', { enum: ['active', 'request', 'declined', 'left'] }).notNull(),
    mutedUntil: ts('muted_until'),
    lastReadMessageId: uuid('last_read_message_id'),
    lastReadAt: ts('last_read_at'),
    joinedAt: ts('joined_at').notNull().defaultNow(),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    senderId: uuid('sender_id'),
    kind: text('kind', { enum: ['text', 'image', 'system', 'poll'] }).notNull(),
    body: text('body'),
    mediaAssetId: uuid('media_asset_id'),
    replyToId: uuid('reply_to_id'),
    pollId: uuid('poll_id'),
    system: jsonb('system').$type<SystemJson>(),
    clientId: text('client_id'),
    deletedAt: ts('deleted_at'),
    heldAt: ts('held_at'),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.createdAt, t.id] })],
);

export const messageClientIds = pgTable(
  'message_client_ids',
  {
    senderId: uuid('sender_id').notNull(),
    clientId: text('client_id').notNull(),
    messageId: uuid('message_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.senderId, t.clientId] })],
);

export const messageReactions = pgTable(
  'message_reactions',
  {
    messageId: uuid('message_id').notNull(),
    userId: uuid('user_id').notNull(),
    emoji: text('emoji').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.messageId, t.userId, t.emoji] })],
);

export const messageHidden = pgTable(
  'message_hidden',
  {
    messageId: uuid('message_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.messageId] })],
);

export const polls = pgTable('polls', {
  id: uuid('id').primaryKey(),
  conversationId: uuid('conversation_id').notNull(),
  creatorId: uuid('creator_id'),
  question: text('question').notNull(),
  multi: boolean('multi').notNull().default(false),
  anonymous: boolean('anonymous').notNull().default(false),
  closesAt: ts('closes_at'),
  closedAt: ts('closed_at'),
  ...timestamps,
});

export const pollOptions = pgTable('poll_options', {
  id: uuid('id').primaryKey(),
  pollId: uuid('poll_id').notNull(),
  text: text('text').notNull(),
  position: integer('position').notNull(),
});

export const pollVotes = pgTable(
  'poll_votes',
  {
    pollId: uuid('poll_id').notNull(),
    optionId: uuid('option_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.pollId, t.optionId, t.userId] })],
);

export const icebreakerCards = pgTable('icebreaker_cards', {
  id: uuid('id').primaryKey(),
  prompt: jsonb('prompt').$type<LocalizedJson>().notNull(),
  category: text('category', { enum: ['light', 'deep', 'playful', 'local'] }).notNull(),
  active: boolean('active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps,
});

export const eventIcebreakerPushes = pgTable('event_icebreaker_pushes', {
  id: uuid('id').primaryKey(),
  eventId: uuid('event_id').notNull(),
  cardId: uuid('card_id').notNull(),
  pushedBy: uuid('pushed_by'),
  pushedAt: ts('pushed_at').notNull().defaultNow(),
});

export const eventSignals = pgTable('event_signals', {
  eventId: uuid('event_id').primaryKey(),
  color: text('color').notNull(),
  icon: text('icon').notNull(),
  assignedAt: ts('assigned_at').notNull().defaultNow(),
});

export const newcomerWelcomes = pgTable(
  'newcomer_welcomes',
  {
    eventId: uuid('event_id').notNull(),
    userId: uuid('user_id').notNull(),
    welcomedBy: uuid('welcomed_by'),
    welcomedAt: ts('welcomed_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] })],
);
