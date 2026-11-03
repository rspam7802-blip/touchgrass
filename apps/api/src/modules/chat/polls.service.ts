import { Inject, Injectable } from '@nestjs/common';
import type { PersonCard, PollView } from '@touchgrass/shared';
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { pollOptions, polls, pollVotes } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { PeopleService } from '../profiles/people.service.js';

type PollRow = typeof polls.$inferSelect;

/** Rules for a vote, kept pure for unit tests (F-CHT-05). */
export function voteProblem(
  poll: { multi: boolean; closedAt: Date | null; closesAt: Date | null },
  optionIds: string[],
  validOptionIds: Set<string>,
  now: Date,
): 'POLL_CLOSED' | 'INVALID_OPTION' | 'SINGLE_CHOICE' | null {
  if (poll.closedAt || (poll.closesAt && poll.closesAt.getTime() <= now.getTime()))
    return 'POLL_CLOSED';
  if (optionIds.some((id) => !validOptionIds.has(id))) return 'INVALID_OPTION';
  if (!poll.multi && new Set(optionIds).size > 1) return 'SINGLE_CHOICE';
  return null;
}

/** Poll storage and per-viewer views (votes, results, voters unless anonymous). */
@Injectable()
export class PollsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly people: PeopleService,
  ) {}

  async byId(id: string, db: DbOrTx = this.db): Promise<PollRow | null> {
    const [row] = await db.select().from(polls).where(eq(polls.id, id)).limit(1);
    return row ?? null;
  }

  async optionIds(pollId: string, db: DbOrTx = this.db): Promise<Set<string>> {
    const rows = await db
      .select({ id: pollOptions.id })
      .from(pollOptions)
      .where(eq(pollOptions.pollId, pollId));
    return new Set(rows.map((r) => r.id));
  }

  async create(
    tx: Tx,
    p: {
      id: string;
      conversationId: string;
      creatorId: string;
      question: string;
      options: string[];
      multi: boolean;
      anonymous: boolean;
      closesAt: Date | null;
    },
  ): Promise<void> {
    await tx.insert(polls).values({
      id: p.id,
      conversationId: p.conversationId,
      creatorId: p.creatorId,
      question: p.question,
      multi: p.multi,
      anonymous: p.anonymous,
      closesAt: p.closesAt,
    });
    await tx
      .insert(pollOptions)
      .values(p.options.map((text, position) => ({ id: uuidv7(), pollId: p.id, text, position })));
  }

  /** Replaces the voter's choice atomically (an empty list withdraws the vote). Row-locks the poll. */
  async setVotes(tx: Tx, pollId: string, userId: string, optionIds: string[]): Promise<void> {
    await tx.execute(sql`SELECT id FROM polls WHERE id = ${pollId} FOR UPDATE`);
    await tx
      .delete(pollVotes)
      .where(and(eq(pollVotes.pollId, pollId), eq(pollVotes.userId, userId)));
    const unique = [...new Set(optionIds)];
    if (unique.length > 0)
      await tx.insert(pollVotes).values(unique.map((optionId) => ({ pollId, optionId, userId })));
  }

  async close(pollId: string, now: Date): Promise<boolean> {
    const rows = await this.db
      .update(polls)
      .set({ closedAt: now })
      .where(and(eq(polls.id, pollId), isNull(polls.closedAt)))
      .returning({ id: polls.id });
    return rows.length > 0;
  }

  /** Polls whose deadline passed and are still open; closed by the worker. */
  async closeDue(now: Date): Promise<PollRow[]> {
    return this.db
      .update(polls)
      .set({ closedAt: now })
      .where(and(isNull(polls.closedAt), lte(polls.closesAt, now)))
      .returning();
  }

  /** Views for one viewer. `viewerId === null` builds the broadcast view (no "mine"). */
  async views(
    viewerId: string | null,
    pollIds: string[],
    now: Date = new Date(),
  ): Promise<Map<string, PollView>> {
    const out = new Map<string, PollView>();
    if (pollIds.length === 0) return out;
    const [rows, options, votes] = await Promise.all([
      this.db.select().from(polls).where(inArray(polls.id, pollIds)),
      this.db
        .select()
        .from(pollOptions)
        .where(inArray(pollOptions.pollId, pollIds))
        .orderBy(asc(pollOptions.position)),
      this.db.select().from(pollVotes).where(inArray(pollVotes.pollId, pollIds)),
    ]);
    const named = rows.filter((p) => !p.anonymous).map((p) => p.id);
    const voterIds = [
      ...new Set(votes.filter((v) => named.includes(v.pollId)).map((v) => v.userId)),
    ];
    const cards: Map<string, PersonCard> = viewerId
      ? await this.people.cards(viewerId, voterIds, { includeSelf: true })
      : new Map<string, PersonCard>();
    for (const p of rows) {
      const pv = votes.filter((v) => v.pollId === p.id);
      out.set(p.id, {
        id: p.id,
        conversationId: p.conversationId,
        question: p.question,
        multi: p.multi,
        anonymous: p.anonymous,
        closesAt: p.closesAt?.toISOString() ?? null,
        closed:
          p.closedAt !== null || (p.closesAt !== null && p.closesAt.getTime() <= now.getTime()),
        options: options
          .filter((o) => o.pollId === p.id)
          .map((o) => {
            const ov = pv.filter((v) => v.optionId === o.id);
            return {
              id: o.id,
              text: o.text,
              votes: ov.length,
              mine: viewerId !== null && ov.some((v) => v.userId === viewerId),
              voters: p.anonymous
                ? []
                : ov.flatMap((v) => {
                    const c = cards.get(v.userId);
                    return c ? [c] : [];
                  }),
            };
          }),
        totalVoters: new Set(pv.map((v) => v.userId)).size,
      });
    }
    return out;
  }

  async eraseVotes(userId: string, tx: DbOrTx): Promise<void> {
    await tx.delete(pollVotes).where(eq(pollVotes.userId, userId));
  }
}
