import { Inject, Injectable } from '@nestjs/common';
import {
  type ConversationList,
  type ConversationListQuery,
  type ConversationSummary,
  decodeCursor,
  encodeCursor,
  LIMITS,
  type MediaVariants,
  type Message,
  type MessagePage,
  type MuteBody,
  ROOMS,
  type SendMessageBody,
  TimeIdCursor,
  type ModerationPreview,
} from '@touchgrass/shared';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import {
  conversationMembers,
  conversations,
  messageClientIds,
  messageHidden,
  messageReactions,
  messages,
  type SystemJson,
} from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { RealtimePublisher } from '../../infra/realtime/realtime-publisher.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { type AfterCommit, GONE } from '../moderation/moderation-targets.js';
import { SanctionsReader } from '../moderation/sanctions-reader.js';
import { EventSearchService } from '../events/event-search.service.js';
import { MediaService } from '../media/media.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import {
  canDeleteForEveryone,
  directKey,
  dmPermission,
  excerpt,
  muteUntil,
  uuidV7Time,
} from './chat.policy.js';
import { type ConversationGate, ConversationGates, type GateAccess } from './conversation-gates.js';
import { PollsService } from './polls.service.js';

export const CHAT_MESSAGE_CREATED_EVENT = 'chat.message_created';
export const CHAT_REQUEST_CREATED_EVENT = 'chat.request_created';

type ConversationRow = typeof conversations.$inferSelect;
type MemberRow = typeof conversationMembers.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

const C = LIMITS.chat;
const PageCursor = TimeIdCursor;

/** What the viewer may do in one conversation, resolved once per request. */
export interface ConversationAccess {
  conv: ConversationRow;
  me: MemberRow | null;
  read: boolean;
  write: boolean;
  /** Why writing is not possible right now (stable code for the client). */
  reason: 'NOT_OPEN' | 'CHAT_CLOSED' | 'NOT_MEMBER' | 'REQUEST_PENDING' | null;
  state: ConversationSummary['state'];
  peerId: string | null;
  gate: GateAccess | null;
}

/**
 * Chat (F-CHT-01..04): direct messages with message requests, event group chats, and the shared message
 * features (replies, images, reactions, read receipts, mute, delete, offline de-duplication). Writes go
 * through REST; fan-out is pushed to each recipient's `user:<id>` room so blocked people never receive each
 * other's messages, and the worker sends pushes from the outbox.
 */
@Injectable()
export class ChatService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly gates: ConversationGates,
    private readonly graph: SocialGraphService,
    private readonly people: PeopleService,
    private readonly profiles: ProfilesService,
    private readonly media: MediaService,
    private readonly eventSearch: EventSearchService,
    private readonly outbox: OutboxService,
    private readonly realtime: RealtimePublisher,
    private readonly polls: PollsService,
    private readonly moderation: ModerationService,
    private readonly sanctions: SanctionsReader,
  ) {}

  // ---------- access ----------

  async conversationRow(id: string): Promise<ConversationRow | null> {
    return this.conversation(id);
  }

  private async conversation(id: string, db: DbOrTx = this.db): Promise<ConversationRow | null> {
    const [row] = await db.select().from(conversations).where(eq(conversations.id, id)).limit(1);
    return row ?? null;
  }

  private async members(conversationId: string, db: DbOrTx = this.db): Promise<MemberRow[]> {
    return db
      .select()
      .from(conversationMembers)
      .where(eq(conversationMembers.conversationId, conversationId));
  }

  private gateFor(conv: ConversationRow): { gate: ConversationGate; refId: string } | null {
    if (conv.kind === 'event' && conv.eventId) {
      const gate = this.gates.get('event');
      return gate ? { gate, refId: conv.eventId } : null;
    }
    if (conv.kind === 'crew' && conv.crewId) {
      const gate = this.gates.get('crew');
      return gate ? { gate, refId: conv.crewId } : null;
    }
    return null;
  }

  /** Resolves access; invisible conversations are 404 (their existence never leaks). */
  async access(
    userId: string,
    conversationId: string,
    now: Date = new Date(),
  ): Promise<ConversationAccess> {
    const conv = await this.conversation(conversationId);
    if (!conv) throw AppError.notFound('Conversation');
    const members = await this.members(conv.id);
    const me = members.find((m) => m.userId === userId) ?? null;
    if (conv.kind === 'direct') {
      const peer = members.find((m) => m.userId !== userId);
      if (!me || !peer || me.status === 'declined' || me.status === 'left')
        throw AppError.notFound('Conversation');
      if (await this.graph.isBlockedEitherWay(userId, peer.userId))
        throw AppError.notFound('Conversation');
      const state: ConversationSummary['state'] =
        me.status === 'request'
          ? 'request_received'
          : peer.status === 'request' || peer.status === 'declined'
            ? 'request_sent'
            : 'active';
      const myCount = state === 'request_sent' ? await this.sentCount(conv.id, userId) : 0;
      const write =
        state === 'active' || (state === 'request_sent' && myCount < C.requestMaxMessages);
      return {
        conv,
        me,
        read: true,
        write,
        reason: write ? null : 'REQUEST_PENDING',
        state,
        peerId: peer.userId,
        gate: null,
      };
    }
    const g = this.gateFor(conv);
    if (!g)
      throw new AppError('CHAT_UNAVAILABLE', 'This chat is not available', {
        reason: 'NOT_MEMBER',
      });
    const gate = await g.gate.access(userId, g.refId, now);
    if (!gate.read) throw AppError.notFound('Conversation');
    return {
      conv,
      me,
      read: true,
      write: gate.write,
      reason: gate.reason,
      state: 'active',
      peerId: null,
      gate,
    };
  }

  private async sentCount(conversationId: string, userId: string): Promise<number> {
    return this.db.$count(
      messages,
      and(eq(messages.conversationId, conversationId), eq(messages.senderId, userId)),
    );
  }

  /** Makes sure the viewer has a member row (event chats are joined on first visit). */
  private async ensureMember(
    conversationId: string,
    userId: string,
    db: DbOrTx = this.db,
  ): Promise<void> {
    await db
      .insert(conversationMembers)
      .values({ conversationId, userId, status: 'active' })
      .onConflictDoUpdate({
        target: [conversationMembers.conversationId, conversationMembers.userId],
        set: { status: 'active' },
        setWhere: eq(conversationMembers.status, 'left'),
      });
  }

  /** Socket room join check (gateway): the viewer must be able to read the conversation. */
  async canJoin(userId: string, conversationId: string): Promise<boolean> {
    try {
      return (await this.access(userId, conversationId)).read;
    } catch {
      return false;
    }
  }

  /** People who should receive a conversation's messages now, minus anyone blocked with `senderId`. */
  async recipients(conv: ConversationRow, senderId: string | null): Promise<string[]> {
    let ids: string[];
    if (conv.kind === 'direct') {
      ids = (await this.members(conv.id))
        .filter((m) => m.status === 'active' || m.status === 'request')
        .map((m) => m.userId);
    } else {
      const g = this.gateFor(conv);
      ids = g ? await g.gate.members(g.refId) : [];
    }
    if (!senderId) return ids;
    const blocked = await this.graph.blockedSet(senderId);
    return ids.filter((id) => !blocked.has(id));
  }

  // ---------- conversations ----------

  /** Opens (or creates) the direct chat with someone; a message request if they are not reachable directly. */
  async startDirect(
    userId: string,
    otherId: string,
    now: Date = new Date(),
  ): Promise<ConversationSummary> {
    if (otherId === userId) throw new AppError('VALIDATION_FAILED', 'You cannot message yourself');
    const blocked = await this.graph.isBlockedEitherWay(userId, otherId);
    const active = (await this.people.cards(userId, [otherId])).get(otherId);
    if (blocked || !active) throw AppError.notFound('User');
    const permission = dmPermission({
      blocked,
      squad: (await this.graph.relationshipStatus(userId, otherId)) === 'squad',
      sharedRecentPlan: await this.eventSearch.haveSharedPlan(
        userId,
        otherId,
        new Date(now.getTime() - C.dmSharedEventWindowMs),
      ),
    });
    const key = directKey(userId, otherId);
    const id = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.directKey, key))
        .limit(1);
      const convId = existing?.id ?? uuidv7();
      if (!existing) {
        await tx
          .insert(conversations)
          .values({ id: convId, kind: 'direct', directKey: key, createdBy: userId })
          .onConflictDoNothing({ target: conversations.directKey });
      }
      const [row] = await tx
        .select({ id: conversations.id })
        .from(conversations)
        .where(eq(conversations.directKey, key))
        .limit(1);
      const finalId = row?.id ?? convId;
      await tx
        .insert(conversationMembers)
        .values([
          { conversationId: finalId, userId, status: 'active' },
          {
            conversationId: finalId,
            userId: otherId,
            status: permission === 'direct' ? 'active' : 'request',
          },
        ])
        .onConflictDoNothing();
      // Reachable now (became squad, or shared a plan): a pending request turns into a normal chat.
      if (permission === 'direct') {
        await tx
          .update(conversationMembers)
          .set({ status: 'active' })
          .where(
            and(
              eq(conversationMembers.conversationId, finalId),
              inArray(conversationMembers.status, ['request', 'left']),
            ),
          );
      }
      return finalId;
    });
    return this.summary(userId, id, now);
  }

  async respondToRequest(
    userId: string,
    conversationId: string,
    accept: boolean,
  ): Promise<ConversationSummary | null> {
    const a = await this.access(userId, conversationId);
    if (a.state !== 'request_received') throw new AppError('CONFLICT', 'No pending request');
    if (!accept) {
      // Declining is silent: the sender keeps seeing "request sent".
      await this.db
        .update(conversationMembers)
        .set({ status: 'declined' })
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, userId),
          ),
        );
      return null;
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(conversationMembers)
        .set({ status: 'active' })
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, userId),
          ),
        );
      await this.insertSystem(tx, conversationId, { type: 'request_accepted' });
    });
    await this.fanOutUpdate(a.conv, null);
    return this.summary(userId, conversationId);
  }

  /** The event's group chat (F-CHT-02); members are joined on first visit while they hold a seat or host. */
  async eventConversation(
    userId: string,
    eventId: string,
    now: Date = new Date(),
  ): Promise<ConversationSummary> {
    const gate = this.gates.get('event');
    if (!gate) throw new AppError('CHAT_UNAVAILABLE', 'Event chat is not available');
    const access = await gate.access(userId, eventId, now);
    if (!access.read) throw AppError.notFound('Conversation');
    const id = await this.ensureEventConversation(eventId);
    await this.ensureMember(id, userId);
    return this.summary(userId, id, now);
  }

  /** A crew's group chat (F-ENG-02); active members are joined on first visit. */
  async crewConversation(
    userId: string,
    crewId: string,
    now: Date = new Date(),
  ): Promise<ConversationSummary> {
    const gate = this.gates.get('crew');
    if (!gate) throw new AppError('CHAT_UNAVAILABLE', 'Crew chat is not available');
    const access = await gate.access(userId, crewId, now);
    if (!access.read) throw AppError.notFound('Conversation');
    await this.db
      .insert(conversations)
      .values({ id: uuidv7(), kind: 'crew', crewId })
      .onConflictDoNothing({ target: conversations.crewId });
    const [row] = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.crewId, crewId))
      .limit(1);
    if (!row) throw new Error('crew conversation missing after upsert');
    await this.ensureMember(row.id, userId);
    return this.summary(userId, row.id, now);
  }

  async ensureEventConversation(eventId: string, db: DbOrTx = this.db): Promise<string> {
    await db
      .insert(conversations)
      .values({ id: uuidv7(), kind: 'event', eventId })
      .onConflictDoNothing({ target: conversations.eventId });
    const [row] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.eventId, eventId))
      .limit(1);
    if (!row) throw new Error('event conversation missing after upsert');
    return row.id;
  }

  /** Everyone who belongs in an event's chat right now (seat holders + hosts). */
  async eventMembers(eventId: string): Promise<string[]> {
    const gate = this.gates.get('event');
    return gate ? gate.members(eventId) : [];
  }

  /** Adds every current member of a group chat (used when an event chat opens). */
  async ensureMembers(
    conversationId: string,
    userIds: string[],
    db: DbOrTx = this.db,
  ): Promise<void> {
    for (const id of userIds) await this.ensureMember(conversationId, id, db);
  }

  async hasSystemMessage(conversationId: string, type: SystemJson['type']): Promise<boolean> {
    const n = await this.db.$count(
      messages,
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.kind, 'system'),
        sql`${messages.system}->>'type' = ${type}`,
      ),
    );
    return n > 0;
  }

  /** Posts a system line (chat opened, icebreaker) and fans it out. */
  async postSystem(conversationId: string, system: SystemJson): Promise<Message> {
    const row = await this.db.transaction((tx) => this.insertSystem(tx, conversationId, system));
    const conv = await this.conversation(conversationId);
    const [dto] = await this.hydrate(row.id, [row]);
    if (!conv || !dto) throw AppError.notFound('Conversation');
    await this.fanOutNew(conv, dto);
    return dto;
  }

  async eventConversationId(eventId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.eventId, eventId))
      .limit(1);
    return row?.id ?? null;
  }

  /** Worker: membership follows seats (joined people see the chat in their inbox; leavers drop out). */
  async syncEventMember(eventId: string, userId: string, member: boolean): Promise<void> {
    const id = await this.eventConversationId(eventId);
    if (!id) return;
    if (member) await this.ensureMember(id, userId);
    else
      await this.db
        .update(conversationMembers)
        .set({ status: 'left' })
        .where(
          and(eq(conversationMembers.conversationId, id), eq(conversationMembers.userId, userId)),
        );
  }

  async summary(
    userId: string,
    conversationId: string,
    now: Date = new Date(),
  ): Promise<ConversationSummary> {
    const [item] = await this.summaries(userId, [conversationId], now);
    if (!item) throw AppError.notFound('Conversation');
    return item;
  }

  /** Inbox (F-CHT-04): newest activity first; requests are listed separately. */
  async list(
    userId: string,
    q: ConversationListQuery,
    now: Date = new Date(),
  ): Promise<ConversationList> {
    const after = q.cursor ? decodeCursor(q.cursor, PageCursor) : null;
    const sortKey = sql`coalesce(${conversations.lastMessageAt}, ${conversations.createdAt})`;
    const rows = await this.db
      .select({ id: conversations.id, t: sql<Date>`${sortKey}` })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .where(
        and(
          eq(conversationMembers.userId, userId),
          eq(conversationMembers.status, q.filter === 'requests' ? 'request' : 'active'),
          after
            ? sql`(${sortKey}, ${conversations.id}) < (${new Date(after.t)}, ${after.id})`
            : undefined,
        ),
      )
      .orderBy(desc(sortKey), desc(conversations.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const items = await this.summaries(
      userId,
      page.map((r) => r.id),
      now,
    );
    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        rows.length > q.limit && last
          ? encodeCursor({ t: new Date(last.t).toISOString(), id: last.id })
          : null,
    };
  }

  /** Builds summaries for conversations the viewer can still read (others are silently dropped). */
  private async summaries(
    userId: string,
    ids: string[],
    now: Date,
  ): Promise<ConversationSummary[]> {
    if (ids.length === 0) return [];
    const convs = await this.db.select().from(conversations).where(inArray(conversations.id, ids));
    const accessById = new Map<string, ConversationAccess>();
    for (const c of convs) {
      try {
        accessById.set(c.id, await this.access(userId, c.id, now));
      } catch {
        // No longer readable (blocked, left the plan): not shown.
      }
    }
    const visible = ids.flatMap((id) =>
      accessById.has(id) ? [accessById.get(id) as ConversationAccess] : [],
    );
    const blocked = await this.graph.blockedSet(userId);
    const peerIds = visible.flatMap((a) => (a.peerId ? [a.peerId] : []));
    const lastIds = visible.flatMap((a) => (a.conv.lastMessageId ? [a.conv.lastMessageId] : []));
    const eventGate = this.gates.get('event');
    const eventIds = visible.flatMap((a) => (a.conv.eventId ? [a.conv.eventId] : []));
    const crewGate = this.gates.get('crew');
    const crewIds = visible.flatMap((a) => (a.conv.crewId ? [a.conv.crewId] : []));
    const [peers, lastRows, unread, eventInfo, crewInfo] = await Promise.all([
      this.people.cards(userId, peerIds),
      this.messagesByIds(lastIds),
      this.unreadCounts(
        userId,
        visible.map((a) => a.conv.id),
        blocked,
      ),
      eventGate
        ? eventGate.info(eventIds)
        : Promise.resolve(new Map<string, { title: string; avatar: MediaVariants | null }>()),
      crewGate && crewIds.length > 0
        ? crewGate.info(crewIds)
        : Promise.resolve(new Map<string, { title: string; avatar: MediaVariants | null }>()),
    ]);
    const senderNames = await this.profiles.displayNames(
      lastRows.flatMap((m) => (m.senderId ? [m.senderId] : [])),
    );
    return visible.flatMap((a) => {
      const peer = a.peerId ? (peers.get(a.peerId) ?? null) : null;
      if (a.conv.kind === 'direct' && !peer) return [];
      const info = a.conv.eventId
        ? eventInfo.get(a.conv.eventId)
        : a.conv.crewId
          ? crewInfo.get(a.conv.crewId)
          : undefined;
      const last = lastRows.find((m) => m.id === a.conv.lastMessageId);
      const lastVisible = last && !(last.senderId && blocked.has(last.senderId));
      return [
        {
          id: a.conv.id,
          kind: a.conv.kind,
          state: a.state,
          title: peer?.displayName ?? info?.title ?? '',
          avatar: peer?.photo ?? info?.avatar ?? null,
          peer,
          eventId: a.conv.eventId,
          lastMessage:
            last && lastVisible
              ? {
                  senderName: last.senderId ? (senderNames.get(last.senderId) ?? null) : null,
                  kind: last.kind,
                  excerpt: last.deletedAt ? null : excerpt(last.body),
                  createdAt: last.createdAt.toISOString(),
                }
              : null,
          unreadCount: unread.get(a.conv.id) ?? 0,
          muted: a.me?.mutedUntil ? a.me.mutedUntil.getTime() > now.getTime() : false,
          readOnly: !a.write,
          canCreatePoll: a.conv.kind === 'event' && a.write && (a.gate?.host ?? false),
          opensAt: a.gate?.opensAt?.toISOString() ?? null,
          closesAt: a.gate?.closesAt?.toISOString() ?? null,
        },
      ];
    });
  }

  private async unreadCounts(
    userId: string,
    ids: string[],
    blocked: Set<string>,
  ): Promise<Map<string, number>> {
    if (ids.length === 0) return new Map();
    const res = await this.db.execute<{ id: string; n: number }>(sql`
      SELECT m.conversation_id AS id, count(*)::int AS n
      FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ${userId}
      WHERE m.conversation_id = ANY(${`{${ids.join(',')}}`}::uuid[])
        AND m.created_at > coalesce(cm.last_read_at, '-infinity'::timestamptz)
        AND m.kind <> 'system' AND m.deleted_at IS NULL AND m.held_at IS NULL
        AND (m.sender_id IS NULL OR m.sender_id <> ${userId})
        AND (m.sender_id IS NULL OR NOT (m.sender_id = ANY(${`{${[...blocked].join(',')}}`}::uuid[])))
        AND NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id = ${userId} AND h.message_id = m.id)
      GROUP BY m.conversation_id`);
    return new Map(res.rows.map((r) => [r.id, r.n]));
  }

  // ---------- messages ----------

  private async messagesByIds(ids: string[], db: DbOrTx = this.db): Promise<MessageRow[]> {
    if (ids.length === 0) return [];
    // created_at = the id's own timestamp, so each lookup names its partition.
    return db
      .select()
      .from(messages)
      .where(
        or(...ids.map((id) => and(eq(messages.createdAt, uuidV7Time(id)), eq(messages.id, id)))),
      );
  }

  async messageInConversation(
    conversationId: string,
    messageId: string,
  ): Promise<MessageRow | null> {
    const [row] = await this.messagesByIds([messageId]);
    return row && row.conversationId === conversationId ? row : null;
  }

  async page(
    userId: string,
    conversationId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<MessagePage> {
    const a = await this.access(userId, conversationId);
    const before = cursor ? decodeCursor(cursor, PageCursor) : null;
    const blocked = await this.graph.blockedSet(userId);
    const rows = await this.db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          before
            ? or(
                lt(messages.createdAt, new Date(before.t)),
                and(eq(messages.createdAt, new Date(before.t)), lt(messages.id, before.id)),
              )
            : undefined,
          blocked.size > 0
            ? sql`(${messages.senderId} IS NULL OR NOT (${messages.senderId} = ANY(${`{${[...blocked].join(',')}}`}::uuid[])))`
            : undefined,
          sql`NOT EXISTS (SELECT 1 FROM message_hidden h WHERE h.user_id = ${userId} AND h.message_id = ${messages.id})`,
          // Held messages are only shown to their sender until reviewed.
          or(isNull(messages.heldAt), eq(messages.senderId, userId)),
        ),
      )
      .orderBy(desc(messages.createdAt), desc(messages.id))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const items = await this.hydrate(userId, page);
    const last = page[page.length - 1];
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ t: last.createdAt.toISOString(), id: last.id })
          : null,
      readBy: await this.readBy(userId, a.conv),
    };
  }

  /** Read receipts are reciprocal: only shown when both the reader and the viewer share them. */
  private async readBy(userId: string, conv: ConversationRow): Promise<MessagePage['readBy']> {
    const mine = await this.profiles.privacy(userId);
    if (!mine.readReceipts) return [];
    const rows = await this.members(conv.id);
    const others = rows.filter((m) => m.userId !== userId && m.lastReadMessageId);
    const sharing = await this.profiles.withPrivacyFlag(
      others.map((m) => m.userId),
      'readReceipts',
    );
    const blocked = await this.graph.blockedSet(userId);
    return others
      .filter((m) => sharing.has(m.userId) && !blocked.has(m.userId))
      .map((m) => ({ userId: m.userId, messageId: m.lastReadMessageId as string }));
  }

  /** Turns rows into DTOs for one viewer (sender cards, replies, reactions, images, polls). */
  async hydrate(viewerId: string, rows: MessageRow[]): Promise<Message[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const replyIds = [...new Set(rows.flatMap((r) => (r.replyToId ? [r.replyToId] : [])))];
    const [replies, reactionRows, cards] = await Promise.all([
      this.messagesByIds(replyIds),
      this.db.select().from(messageReactions).where(inArray(messageReactions.messageId, ids)),
      this.people.cards(
        viewerId,
        rows.flatMap((r) => (r.senderId ? [r.senderId] : [])),
        { includeSelf: true },
      ),
    ]);
    const replyNames = await this.profiles.displayNames(
      replies.flatMap((r) => (r.senderId ? [r.senderId] : [])),
    );
    const mediaIds = rows.flatMap((r) => (r.mediaAssetId && !r.deletedAt ? [r.mediaAssetId] : []));
    const images = new Map<string, MediaVariants | null>();
    for (const m of await this.media.byIds(mediaIds))
      images.set(m.id, m.status === 'ready' ? await this.media.urlsFor(m.variantKeys) : null);
    const pollIds = rows.flatMap((r) => (r.pollId ? [r.pollId] : []));
    const pollViews = await this.polls.views(viewerId, pollIds);
    return rows.map((r) => {
      const reply = r.replyToId ? replies.find((x) => x.id === r.replyToId) : undefined;
      const reacts = reactionRows.filter((x) => x.messageId === r.id);
      const byEmoji = new Map<string, { count: number; mine: boolean }>();
      for (const x of reacts) {
        const cur = byEmoji.get(x.emoji) ?? { count: 0, mine: false };
        byEmoji.set(x.emoji, { count: cur.count + 1, mine: cur.mine || x.userId === viewerId });
      }
      const deleted = r.deletedAt !== null;
      return {
        id: r.id,
        conversationId: r.conversationId,
        sender: r.senderId ? (cards.get(r.senderId) ?? null) : null,
        mine: r.senderId === viewerId,
        kind: r.kind,
        body: deleted ? null : r.body,
        image: deleted || !r.mediaAssetId ? null : (images.get(r.mediaAssetId) ?? null),
        replyTo: reply
          ? {
              id: reply.id,
              senderName: reply.senderId ? (replyNames.get(reply.senderId) ?? null) : null,
              excerpt:
                reply.deletedAt || (reply.heldAt && reply.senderId !== viewerId)
                  ? null
                  : excerpt(reply.body),
            }
          : null,
        reactions: [...byEmoji].map(([emoji, v]) => ({
          emoji: emoji as Message['reactions'][number]['emoji'],
          ...v,
        })),
        poll: r.pollId ? (pollViews.get(r.pollId) ?? null) : null,
        system: r.system,
        deleted,
        held: r.heldAt !== null && r.senderId === viewerId,
        clientId: r.senderId === viewerId ? r.clientId : null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /**
   * Sends a message. The same clientId from the same sender always returns the original message (offline queue
   * retries never duplicate), even under concurrent retries.
   */
  async send(
    userId: string,
    conversationId: string,
    body: SendMessageBody,
    now: Date = new Date(),
  ): Promise<Message> {
    const existing = await this.byClientId(userId, body.clientId);
    if (existing) return existing;
    const a = await this.access(userId, conversationId, now);
    this.assertWritable(a);
    await this.sanctions.assertCanPost(userId, now);
    const screen = this.moderation.screen(body.kind === 'text' ? body.body : null);
    const heldAt = screen.flagged ? now : null;
    if (body.replyToId && !(await this.messageInConversation(conversationId, body.replyToId)))
      throw new AppError('VALIDATION_FAILED', 'Reply target not found', [
        { path: 'replyToId', message: 'Not in this chat', code: 'custom' },
      ]);
    if (body.kind === 'image' && body.mediaId) {
      const asset = await this.media.ownedOrThrow(userId, body.mediaId);
      if (asset.purpose !== 'chat')
        throw new AppError('VALIDATION_FAILED', 'Not a chat image', [
          { path: 'mediaId', message: 'Wrong purpose', code: 'custom' },
        ]);
      if (asset.status !== 'ready')
        throw new AppError('MEDIA_NOT_READY', 'Image is still processing');
    }
    const id = uuidv7();
    const created = await this.db.transaction(async (tx) => {
      const claimed = await tx
        .insert(messageClientIds)
        .values({ senderId: userId, clientId: body.clientId, messageId: id })
        .onConflictDoNothing()
        .returning({ id: messageClientIds.messageId });
      if (claimed.length === 0) return null;
      if (a.conv.kind !== 'direct') await this.ensureMember(conversationId, userId, tx);
      const row = await this.insertMessage(tx, {
        id,
        conversationId,
        senderId: userId,
        kind: body.kind,
        body: body.body ?? null,
        mediaAssetId: body.kind === 'image' ? (body.mediaId ?? null) : null,
        replyToId: body.replyToId ?? null,
        clientId: body.clientId,
        heldAt,
      });
      await this.moderation.flagText({ type: 'message', id }, screen, tx);
      // Your own message counts as read.
      await tx
        .update(conversationMembers)
        .set({ lastReadMessageId: id, lastReadAt: row.createdAt })
        .where(
          and(
            eq(conversationMembers.conversationId, conversationId),
            eq(conversationMembers.userId, userId),
          ),
        );
      // Held messages notify nobody; they reach the others only if a moderator releases them.
      if (!heldAt)
        await this.outbox.add(tx, {
          aggregateType: 'conversation',
          aggregateId: conversationId,
          type:
            a.state === 'request_sent' ? CHAT_REQUEST_CREATED_EVENT : CHAT_MESSAGE_CREATED_EVENT,
          payload: { conversationId, messageId: id, senderId: userId, kind: body.kind },
        });
      return row;
    });
    if (!created) {
      const winner = await this.byClientId(userId, body.clientId);
      if (!winner) throw new AppError('CONFLICT', 'Message is being sent, retry');
      return winner;
    }
    const [dto] = await this.hydrate(userId, [created]);
    if (!dto) throw AppError.notFound('Message');
    await this.fanOutNew(a.conv, dto);
    return dto;
  }

  private assertWritable(a: ConversationAccess): void {
    if (a.write) return;
    if (a.reason === 'REQUEST_PENDING' || a.state === 'request_received')
      throw new AppError('MESSAGE_REQUEST_PENDING', 'Waiting for them to accept');
    throw new AppError('CHAT_UNAVAILABLE', 'This chat is read-only', {
      reason: a.reason ?? 'NOT_MEMBER',
    });
  }

  private async byClientId(userId: string, clientId: string): Promise<Message | null> {
    const [hit] = await this.db
      .select({ messageId: messageClientIds.messageId })
      .from(messageClientIds)
      .where(and(eq(messageClientIds.senderId, userId), eq(messageClientIds.clientId, clientId)))
      .limit(1);
    if (!hit) return null;
    const rows = await this.messagesByIds([hit.messageId]);
    const [dto] = await this.hydrate(userId, rows);
    return dto ?? null;
  }

  async insertMessage(
    tx: Tx,
    m: Omit<typeof messages.$inferInsert, 'createdAt' | 'id'> & { id?: string },
  ): Promise<MessageRow> {
    const id = m.id ?? uuidv7();
    const [row] = await tx
      .insert(messages)
      .values({ ...m, id, createdAt: uuidV7Time(id) })
      .returning();
    if (!row) throw new Error('message insert returned nothing');
    if (!row.heldAt)
      await tx
        .update(conversations)
        .set({ lastMessageId: id, lastMessageAt: row.createdAt })
        .where(eq(conversations.id, m.conversationId));
    return row;
  }

  async insertSystem(tx: Tx, conversationId: string, system: SystemJson): Promise<MessageRow> {
    return this.insertMessage(tx, {
      conversationId,
      senderId: null,
      kind: 'system',
      system,
      body: null,
    });
  }

  /** Publishes a new message to each recipient's own room; senders' other devices get `mine: true`. */
  async fanOutNew(conv: ConversationRow, dto: Message): Promise<void> {
    const senderId = dto.sender?.id ?? null;
    const to = dto.held ? [] : await this.recipients(conv, senderId);
    const others = to.filter((id) => id !== senderId).map(ROOMS.user);
    if (others.length > 0)
      this.realtime.toChat(others, 'message:new', {
        ...dto,
        mine: false,
        clientId: null,
        reactions: dto.reactions.map((r) => ({ ...r, mine: false })),
      });
    if (senderId) this.realtime.toChat(ROOMS.user(senderId), 'message:new', dto);
  }

  private async fanOutUpdate(conv: ConversationRow, messageId: string | null): Promise<void> {
    const to = (await this.recipients(conv, null)).map(ROOMS.user);
    if (to.length === 0) return;
    if (messageId)
      this.realtime.toChat(to, 'message:updated', { conversationId: conv.id, messageId });
    else this.realtime.toChat(to, 'conversation:updated', { conversationId: conv.id });
  }

  /** Moves the read marker forward only (late or duplicate reads never move it back). */
  async markRead(userId: string, conversationId: string, messageId: string): Promise<void> {
    const a = await this.access(userId, conversationId);
    const msg = await this.messageInConversation(conversationId, messageId);
    if (!msg) throw AppError.notFound('Message');
    if (a.conv.kind !== 'direct') await this.ensureMember(conversationId, userId);
    const moved = await this.db
      .update(conversationMembers)
      .set({ lastReadMessageId: messageId, lastReadAt: msg.createdAt })
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.userId, userId),
          or(
            isNull(conversationMembers.lastReadAt),
            lt(conversationMembers.lastReadAt, msg.createdAt),
          ),
        ),
      )
      .returning({ userId: conversationMembers.userId });
    if (moved.length === 0) return;
    // Own devices always sync; others only see the receipt if this reader shares read receipts.
    const payload = { conversationId, userId, messageId };
    this.realtime.toChat(ROOMS.user(userId), 'conversation:read', payload);
    if ((await this.profiles.privacy(userId)).readReceipts) {
      const to = (await this.recipients(a.conv, userId))
        .filter((id) => id !== userId)
        .map(ROOMS.user);
      if (to.length > 0) this.realtime.toChat(to, 'conversation:read', payload);
    }
  }

  async mute(
    userId: string,
    conversationId: string,
    body: MuteBody,
    now: Date = new Date(),
  ): Promise<ConversationSummary> {
    const a = await this.access(userId, conversationId, now);
    if (a.conv.kind !== 'direct') await this.ensureMember(conversationId, userId);
    await this.db
      .update(conversationMembers)
      .set({ mutedUntil: muteUntil(body.duration, now) })
      .where(
        and(
          eq(conversationMembers.conversationId, conversationId),
          eq(conversationMembers.userId, userId),
        ),
      );
    return this.summary(userId, conversationId, now);
  }

  async react(
    userId: string,
    conversationId: string,
    messageId: string,
    emoji: string,
    add: boolean,
  ): Promise<Message> {
    const a = await this.access(userId, conversationId);
    if (a.state === 'request_received')
      throw new AppError('MESSAGE_REQUEST_PENDING', 'Accept the request first');
    const msg = await this.messageInConversation(conversationId, messageId);
    if (!msg || msg.deletedAt || msg.kind === 'system') throw AppError.notFound('Message');
    if (add)
      await this.db
        .insert(messageReactions)
        .values({ messageId, userId, emoji })
        .onConflictDoNothing();
    else
      await this.db
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, messageId),
            eq(messageReactions.userId, userId),
            eq(messageReactions.emoji, emoji),
          ),
        );
    await this.fanOutUpdate(a.conv, messageId);
    const [dto] = await this.hydrate(userId, [msg]);
    if (!dto) throw AppError.notFound('Message');
    return dto;
  }

  /** Delete for me (hide), or for everyone within an hour of sending (own messages only). */
  async deleteMessage(
    userId: string,
    conversationId: string,
    messageId: string,
    scope: 'me' | 'everyone',
    now: Date = new Date(),
  ): Promise<void> {
    const a = await this.access(userId, conversationId, now);
    const msg = await this.messageInConversation(conversationId, messageId);
    if (!msg) throw AppError.notFound('Message');
    if (scope === 'me') {
      await this.db.insert(messageHidden).values({ messageId, userId }).onConflictDoNothing();
      return;
    }
    if (msg.senderId !== userId)
      throw new AppError('FORBIDDEN', 'You can only delete your own messages for everyone');
    if (!canDeleteForEveryone(msg.createdAt, now))
      throw new AppError('CONFLICT', 'Too late to delete for everyone', { reason: 'TOO_LATE' });
    await this.db
      .update(messages)
      .set({ deletedAt: now, body: null, mediaAssetId: null })
      .where(and(eq(messages.createdAt, msg.createdAt), eq(messages.id, messageId)));
    await this.db.delete(messageReactions).where(eq(messageReactions.messageId, messageId));
    await this.fanOutUpdate(a.conv, messageId);
  }

  async message(userId: string, conversationId: string, messageId: string): Promise<Message> {
    await this.access(userId, conversationId);
    const msg = await this.messageInConversation(conversationId, messageId);
    const blocked = await this.graph.blockedSet(userId);
    if (
      !msg ||
      (msg.senderId && blocked.has(msg.senderId)) ||
      (msg.heldAt && msg.senderId !== userId)
    )
      throw AppError.notFound('Message');
    const [dto] = await this.hydrate(userId, [msg]);
    if (!dto) throw AppError.notFound('Message');
    return dto;
  }

  // ---------- push targets (worker) ----------

  /** Who gets a push for a new message: recipients minus the sender, muted members and people looking at it. */
  async pushRecipients(
    conversationId: string,
    senderId: string,
    present: (userId: string) => Promise<boolean>,
    now: Date = new Date(),
  ): Promise<{ conv: ConversationRow; userIds: string[] } | null> {
    const conv = await this.conversation(conversationId);
    if (!conv) return null;
    const to = (await this.recipients(conv, senderId)).filter((id) => id !== senderId);
    const muted = new Set(
      (await this.members(conversationId))
        .filter((m) => m.mutedUntil && m.mutedUntil.getTime() > now.getTime())
        .map((m) => m.userId),
    );
    const out: string[] = [];
    for (const id of to) if (!muted.has(id) && !(await present(id))) out.push(id);
    return { conv, userIds: out };
  }

  async rawMessage(messageId: string): Promise<MessageRow | null> {
    const [row] = await this.messagesByIds([messageId]);
    return row ?? null;
  }

  async conversationTitle(conv: ConversationRow): Promise<string | null> {
    const ref = conv.eventId ?? conv.crewId;
    if (!ref) return null;
    const gate = this.gates.get(conv.eventId ? 'event' : 'crew');
    return gate ? ((await gate.info([ref])).get(ref)?.title ?? null) : null;
  }

  // ---------- moderation (F-SAF-06) ----------

  async moderationPreview(messageId: string): Promise<ModerationPreview> {
    const msg = await this.rawMessage(messageId);
    if (!msg || msg.deletedAt) return GONE;
    const conv = await this.conversation(msg.conversationId);
    const [owner, image] = await Promise.all([
      this.profiles.displayNames(msg.senderId ? [msg.senderId] : []),
      msg.mediaAssetId
        ? this.media
            .byId(msg.mediaAssetId)
            .then((m) => (m ? this.media.urlsFor(m.variantKeys) : null))
        : Promise.resolve(null),
    ]);
    const title = conv ? await this.conversationTitle(conv) : null;
    return {
      title: title ?? 'Direct message',
      text: msg.body,
      image,
      owner: msg.senderId ? { id: msg.senderId, displayName: owner.get(msg.senderId) ?? '' } : null,
      gone: false,
    };
  }

  /** Releases a held message: it reaches the conversation as if just sent (no push, it is late news). */
  async releaseHeld(messageId: string, tx: Tx): Promise<AfterCommit> {
    const msg = await this.rawMessage(messageId);
    if (!msg?.heldAt || msg.deletedAt) return undefined;
    await tx
      .update(messages)
      .set({ heldAt: null })
      .where(and(eq(messages.createdAt, msg.createdAt), eq(messages.id, messageId)));
    await tx
      .update(conversations)
      .set({ lastMessageId: msg.id, lastMessageAt: msg.createdAt })
      .where(
        and(
          eq(conversations.id, msg.conversationId),
          or(isNull(conversations.lastMessageAt), lt(conversations.lastMessageAt, msg.createdAt)),
        ),
      );
    return async () => {
      const conv = await this.conversation(msg.conversationId);
      const [row] = await this.messagesByIds([messageId]);
      if (!conv || !row?.senderId) return;
      const [dto] = await this.hydrate(row.senderId, [row]);
      if (dto) await this.fanOutNew(conv, dto);
    };
  }

  /** Takes a message down for everyone (moderator removal). */
  async removeForModeration(messageId: string, tx: Tx): Promise<AfterCommit> {
    const msg = await this.rawMessage(messageId);
    if (!msg || msg.deletedAt) return undefined;
    await tx
      .update(messages)
      .set({ deletedAt: new Date(), body: null, mediaAssetId: null, heldAt: null })
      .where(and(eq(messages.createdAt, msg.createdAt), eq(messages.id, messageId)));
    await tx.delete(messageReactions).where(eq(messageReactions.messageId, messageId));
    return async () => {
      const conv = await this.conversation(msg.conversationId);
      if (conv) await this.fanOutUpdate(conv, messageId);
    };
  }

  // ---------- reports & account data ----------

  /** Report target for messages: the reporter must be able to read the conversation. */
  async reportTarget(
    reporterId: string,
    messageId: string,
  ): Promise<{ cityId: string | null; ownerUserId: string | null } | null> {
    const msg = await this.rawMessage(messageId);
    if (!msg || !(await this.canJoin(reporterId, msg.conversationId))) return null;
    return { cityId: null, ownerUserId: msg.senderId };
  }

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const sent = await this.db
      .select({
        conversationId: messages.conversationId,
        kind: messages.kind,
        body: messages.body,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(eq(messages.senderId, userId));
    return { messagesSent: sent.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })) };
  }

  /** Erasure: message content goes (others keep a "deleted" line for context); memberships and reactions go. */
  async eraseFor(userId: string, tx: Tx, now: Date = new Date()): Promise<void> {
    await tx
      .update(messages)
      .set({ body: null, mediaAssetId: null, deletedAt: now, senderId: null })
      .where(eq(messages.senderId, userId));
    await tx.delete(messageReactions).where(eq(messageReactions.userId, userId));
    await tx.delete(messageHidden).where(eq(messageHidden.userId, userId));
    await tx.delete(messageClientIds).where(eq(messageClientIds.senderId, userId));
    await tx.delete(conversationMembers).where(eq(conversationMembers.userId, userId));
  }

  /** Daily: forget offline-queue client ids older than a week. */
  async purgeClientIds(now: Date = new Date()): Promise<number> {
    const rows = await this.db
      .delete(messageClientIds)
      .where(lt(messageClientIds.createdAt, new Date(now.getTime() - C.clientIdRetentionMs)))
      .returning({ id: messageClientIds.messageId });
    return rows.length;
  }
}
