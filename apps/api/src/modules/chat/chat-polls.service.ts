import { Inject, Injectable } from '@nestjs/common';
import { type CreatePollBody, type Message, type PollView, ROOMS } from '@touchgrass/shared';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { RealtimePublisher } from '../../infra/realtime/realtime-publisher.js';
import { EventStore } from '../events/event-store.service.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { SanctionsReader } from '../moderation/sanctions-reader.js';
import { ChatService } from './chat.service.js';
import { PollsService, voteProblem } from './polls.service.js';

/**
 * Event polls (F-CHT-05): hosts ask, everyone in the chat votes (single or multiple choice, optional deadline,
 * optional anonymity); results update live for everyone in the chat.
 */
@Injectable()
export class ChatPollsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly chat: ChatService,
    private readonly polls: PollsService,
    private readonly store: EventStore,
    private readonly realtime: RealtimePublisher,
    private readonly moderation: ModerationService,
    private readonly sanctions: SanctionsReader,
  ) {}

  async create(
    userId: string,
    conversationId: string,
    body: CreatePollBody,
    now: Date = new Date(),
  ): Promise<Message> {
    const a = await this.chat.access(userId, conversationId, now);
    if (a.conv.kind !== 'event' || !a.conv.eventId)
      throw new AppError('VALIDATION_FAILED', 'Polls are for plan chats');
    if (!(await this.store.hosts(a.conv.eventId)).some((h) => h.userId === userId))
      throw new AppError('FORBIDDEN', 'Only hosts can start a poll', { reason: 'NOT_HOST' });
    if (!a.write)
      throw new AppError('CHAT_UNAVAILABLE', 'This chat is read-only', {
        reason: a.reason ?? 'CHAT_CLOSED',
      });
    await this.sanctions.assertCanPost(userId, now);
    // Poll wording is short and shown to everyone in the chat, so flagged words are refused, not held.
    if (this.moderation.screen(body.question, ...body.options).flagged)
      throw new AppError('VALIDATION_FAILED', 'Pick different words', [
        { path: 'question', message: 'Pick different words', code: 'custom' },
      ]);
    const closesAt = body.closesAt ? new Date(body.closesAt) : null;
    if (closesAt && closesAt.getTime() <= now.getTime())
      throw new AppError('VALIDATION_FAILED', 'Deadline must be in the future', [
        { path: 'closesAt', message: 'In the past', code: 'custom' },
      ]);
    const pollId = uuidv7();
    const row = await this.db.transaction(async (tx) => {
      await this.polls.create(tx, {
        id: pollId,
        conversationId,
        creatorId: userId,
        question: body.question,
        options: body.options,
        multi: body.multi,
        anonymous: body.anonymous,
        closesAt,
      });
      return this.chat.insertMessage(tx, {
        conversationId,
        senderId: userId,
        kind: 'poll',
        pollId,
        body: body.question,
      });
    });
    const [dto] = await this.chat.hydrate(userId, [row]);
    if (!dto) throw AppError.notFound('Poll');
    await this.chat.fanOutNew(a.conv, dto);
    return dto;
  }

  async vote(
    userId: string,
    pollId: string,
    optionIds: string[],
    now: Date = new Date(),
  ): Promise<PollView> {
    const poll = await this.polls.byId(pollId);
    if (!poll) throw AppError.notFound('Poll');
    const a = await this.chat.access(userId, poll.conversationId, now);
    if (!a.write)
      throw new AppError('CHAT_UNAVAILABLE', 'This chat is read-only', {
        reason: a.reason ?? 'CHAT_CLOSED',
      });
    const problem = voteProblem(poll, optionIds, await this.polls.optionIds(pollId), now);
    if (problem === 'POLL_CLOSED')
      throw new AppError('CONFLICT', 'This poll has closed', { reason: 'POLL_CLOSED' });
    if (problem)
      throw new AppError('VALIDATION_FAILED', 'Invalid choice', [
        { path: 'optionIds', message: problem, code: 'custom' },
      ]);
    await this.db.transaction((tx) => this.polls.setVotes(tx, pollId, userId, optionIds));
    await this.broadcast(poll.conversationId, pollId, now);
    const view = (await this.polls.views(userId, [pollId], now)).get(pollId);
    if (!view) throw AppError.notFound('Poll');
    return view;
  }

  async close(userId: string, pollId: string, now: Date = new Date()): Promise<PollView> {
    const poll = await this.polls.byId(pollId);
    if (!poll) throw AppError.notFound('Poll');
    const a = await this.chat.access(userId, poll.conversationId, now);
    const isHost = a.conv.eventId
      ? (await this.store.hosts(a.conv.eventId)).some((h) => h.userId === userId)
      : false;
    if (poll.creatorId !== userId && !isHost)
      throw new AppError('FORBIDDEN', 'Only hosts can close a poll', { reason: 'NOT_HOST' });
    await this.polls.close(pollId, now);
    await this.broadcast(poll.conversationId, pollId, now);
    const view = (await this.polls.views(userId, [pollId], now)).get(pollId);
    if (!view) throw AppError.notFound('Poll');
    return view;
  }

  /** Worker: closes polls past their deadline and tells the chat. */
  async closeDue(now: Date = new Date()): Promise<number> {
    const closed = await this.polls.closeDue(now);
    for (const p of closed) await this.broadcast(p.conversationId, p.id, now);
    return closed.length;
  }

  /** Live results to everyone in the chat (no "mine": each client keeps its own choice). */
  private async broadcast(conversationId: string, pollId: string, now: Date): Promise<void> {
    const view = (await this.polls.views(null, [pollId], now)).get(pollId);
    const conv = await this.chat.conversationRow(conversationId);
    if (!view || !conv) return;
    const to = (await this.chat.recipients(conv, null)).map(ROOMS.user);
    if (to.length > 0) this.realtime.toChat(to, 'poll:updated', view);
  }
}
