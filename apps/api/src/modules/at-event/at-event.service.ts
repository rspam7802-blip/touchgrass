import { Inject, Injectable } from '@nestjs/common';
import {
  type EventSignal,
  type IcebreakerCard,
  type IcebreakerDeck,
  LIMITS,
  type NewcomerList,
  ROOMS,
  type UpsertIcebreakerBody,
} from '@touchgrass/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import {
  eventIcebreakerPushes,
  eventSignals,
  icebreakerCards,
  newcomerWelcomes,
} from '../../infra/database/schema/index.js';
import { RealtimePublisher } from '../../infra/realtime/realtime-publisher.js';
import { ChatService } from '../chat/chat.service.js';
import { EventAccessService } from '../events/event-access.service.js';
import { canViewEvent, holdsSeat } from '../events/event.policy.js';
import { EventSearchService } from '../events/event-search.service.js';
import { type EventCore, EventStore } from '../events/event-store.service.js';
import { RsvpService } from '../events/rsvp.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { colorName, deckOrder, iconName, pickSignal } from './signal.js';

type CardRow = typeof icebreakerCards.$inferSelect;
/** Plans whose spots are this close share a find-your-group palette. */
const SIGNAL_NEIGHBOURHOOD_METERS = 300;
const HOUR = 3_600_000;

const toCard = (r: CardRow): IcebreakerCard => ({
  id: r.id,
  prompt: r.prompt,
  category: r.category,
  active: r.active,
});

/**
 * At the event (F-ATE-01..03): the icebreaker deck and host pushes to every screen, the find-your-group
 * signal, and the welcome-host checklist for first-timers. Event chats opening with an icebreaker live here
 * too, since the deck is owned here.
 */
@Injectable()
export class AtEventService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly store: EventStore,
    private readonly access: EventAccessService,
    private readonly search: EventSearchService,
    private readonly rsvps: RsvpService,
    private readonly chat: ChatService,
    private readonly profiles: ProfilesService,
    private readonly realtime: RealtimePublisher,
  ) {}

  /** Seat holders and hosts only; anyone else gets a 404 (the plan may not even be visible). */
  private async participant(
    userId: string,
    eventId: string,
  ): Promise<{ core: EventCore; host: boolean }> {
    const core = await this.store.core(eventId);
    if (!core) throw AppError.notFound('Event');
    const ctx = await this.access.context(userId);
    const facts = await this.access.facts(ctx, eventId);
    if (!canViewEvent(facts, core) || (facts.hostRole === null && !holdsSeat(facts.rsvp)))
      throw AppError.notFound('Event');
    return { core, host: facts.hostRole !== null };
  }

  // ---------- icebreakers (F-ATE-01) ----------

  async activeCards(): Promise<CardRow[]> {
    return this.db
      .select()
      .from(icebreakerCards)
      .where(eq(icebreakerCards.active, true))
      .orderBy(asc(icebreakerCards.sortOrder), asc(icebreakerCards.id));
  }

  async deckFor(userId: string, eventId: string): Promise<IcebreakerDeck> {
    await this.participant(userId, eventId);
    return { items: deckOrder(eventId, await this.activeCards()).map(toCard) };
  }

  async push(
    userId: string,
    eventId: string,
    cardId: string,
    now: Date = new Date(),
  ): Promise<IcebreakerCard> {
    const { core, host } = await this.participant(userId, eventId);
    if (!host)
      throw new AppError('FORBIDDEN', 'Only hosts can show everyone a card', {
        reason: 'NOT_HOST',
      });
    if (core.status !== 'published' || now.getTime() >= core.endsAt.getTime())
      throw new AppError('EVENT_CLOSED', 'This plan is over');
    const [card] = await this.db
      .select()
      .from(icebreakerCards)
      .where(and(eq(icebreakerCards.id, cardId), eq(icebreakerCards.active, true)))
      .limit(1);
    if (!card) throw AppError.notFound('Card');
    await this.db
      .insert(eventIcebreakerPushes)
      .values({ id: uuidv7(), eventId, cardId, pushedBy: userId });
    const dto = toCard(card);
    this.realtime.toEvents(ROOMS.event(eventId), 'icebreaker:show', { eventId, card: dto });
    // It also lands in the group chat, for anyone not looking at the screen right then.
    const conversationId = await this.chat.ensureEventConversation(eventId);
    await this.chat.postSystem(conversationId, { type: 'icebreaker', prompt: card.prompt });
    return dto;
  }

  async adminList(): Promise<IcebreakerDeck> {
    const rows = await this.db
      .select()
      .from(icebreakerCards)
      .orderBy(asc(icebreakerCards.sortOrder), asc(icebreakerCards.id));
    return { items: rows.map(toCard) };
  }

  async adminCreate(body: UpsertIcebreakerBody): Promise<IcebreakerCard> {
    const [max] = await this.db
      .select({ n: sql<number>`coalesce(max(${icebreakerCards.sortOrder}), 0)::int` })
      .from(icebreakerCards);
    const [row] = await this.db
      .insert(icebreakerCards)
      .values({
        id: uuidv7(),
        prompt: body.prompt,
        category: body.category,
        active: body.active,
        sortOrder: (max?.n ?? 0) + 1,
      })
      .returning();
    if (!row) throw new Error('card insert returned nothing');
    return toCard(row);
  }

  async adminUpdate(id: string, body: UpsertIcebreakerBody): Promise<IcebreakerCard> {
    const [row] = await this.db
      .update(icebreakerCards)
      .set({ prompt: body.prompt, category: body.category, active: body.active })
      .where(eq(icebreakerCards.id, id))
      .returning();
    if (!row) throw AppError.notFound('Card');
    return toCard(row);
  }

  /**
   * Worker (every 10 min): plans starting within 24 h get their group chat opened with an icebreaker, and
   * everyone holding a seat is added so it shows in their inbox (F-CHT-02).
   */
  async openEventChats(now: Date = new Date()): Promise<number> {
    const ids = await this.search.startingBetween(
      now,
      new Date(now.getTime() + LIMITS.chat.eventChatOpensBeforeMs),
    );
    const cards = await this.activeCards();
    const gateMembers = (eventId: string) => this.chat.eventMembers(eventId);
    let opened = 0;
    for (const eventId of ids) {
      const conversationId = await this.chat.ensureEventConversation(eventId);
      if (await this.chat.hasSystemMessage(conversationId, 'chat_opened')) continue;
      await this.chat.ensureMembers(conversationId, await gateMembers(eventId));
      const [card] = deckOrder(eventId, cards);
      await this.chat.postSystem(conversationId, {
        type: 'chat_opened',
        prompt: card?.prompt ?? null,
      });
      opened += 1;
    }
    return opened;
  }

  // ---------- find-your-group (F-ATE-02) ----------

  async signal(userId: string, eventId: string, now: Date = new Date()): Promise<EventSignal> {
    const { core } = await this.participant(userId, eventId);
    const availableFrom = new Date(core.startsAt.getTime() - LIMITS.signal.showBeforeMs);
    if (now.getTime() < availableFrom.getTime())
      throw new AppError('CONFLICT', 'Your signal shows up 30 minutes before', {
        reason: 'SIGNAL_NOT_YET',
        availableFrom: availableFrom.toISOString(),
      });
    if (core.status !== 'published' || now.getTime() > core.endsAt.getTime() + HOUR)
      throw new AppError('EVENT_CLOSED', 'This plan is over');
    const assigned = await this.assignSignal(eventId);
    return {
      color: assigned.color,
      icon: assigned.icon,
      colorName: colorName(assigned.color),
      iconName: iconName(assigned.icon),
      availableFrom: availableFrom.toISOString(),
    };
  }

  /** Assigns once, under a transaction-scoped advisory lock so two nearby plans never get the same pair. */
  private async assignSignal(eventId: string): Promise<{ color: string; icon: string }> {
    const [existing] = await this.db
      .select()
      .from(eventSignals)
      .where(eq(eventSignals.eventId, eventId))
      .limit(1);
    if (existing) return existing;
    const nearby = await this.search.overlappingNearby(eventId, SIGNAL_NEIGHBOURHOOD_METERS);
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('event-signal-assignment'))`);
      const [again] = await tx
        .select()
        .from(eventSignals)
        .where(eq(eventSignals.eventId, eventId))
        .limit(1);
      if (again) return again;
      const taken =
        nearby.length > 0
          ? await tx.select().from(eventSignals).where(inArray(eventSignals.eventId, nearby))
          : [];
      const pick = pickSignal(eventId, taken);
      if (!pick) throw new AppError('CONFLICT', 'No free signal nearby');
      await tx.insert(eventSignals).values({ eventId, color: pick.color, icon: pick.icon });
      return pick;
    });
  }

  // ---------- newcomer welcome (F-ATE-03) ----------

  async newcomers(userId: string, eventId: string): Promise<NewcomerList> {
    const { host } = await this.participant(userId, eventId);
    if (!host)
      throw new AppError('FORBIDDEN', 'Only hosts see the welcome list', { reason: 'NOT_HOST' });
    const attendees = await this.rsvps.attendees(userId, eventId);
    const firsts = attendees.items.filter(
      (a) => a.firstTime && !a.isHost && a.status !== 'waitlisted',
    );
    const welcomes = firsts.length
      ? await this.db
          .select()
          .from(newcomerWelcomes)
          .where(
            and(
              eq(newcomerWelcomes.eventId, eventId),
              inArray(
                newcomerWelcomes.userId,
                firsts.map((f) => f.person.id),
              ),
            ),
          )
      : [];
    const names = await this.profiles.displayNames(
      welcomes.flatMap((w) => (w.welcomedBy ? [w.welcomedBy] : [])),
    );
    return {
      items: firsts.map((f) => {
        const w = welcomes.find((x) => x.userId === f.person.id);
        return {
          person: f.person,
          welcomed: w !== undefined,
          welcomedBy: w?.welcomedBy ? (names.get(w.welcomedBy) ?? null) : null,
          checkedIn: f.status === 'checked_in',
        };
      }),
    };
  }

  async welcome(
    userId: string,
    eventId: string,
    newcomerId: string,
    welcomed: boolean,
  ): Promise<NewcomerList> {
    const list = await this.newcomers(userId, eventId);
    if (!list.items.some((i) => i.person.id === newcomerId)) throw AppError.notFound('Newcomer');
    if (welcomed)
      await this.db
        .insert(newcomerWelcomes)
        .values({ eventId, userId: newcomerId, welcomedBy: userId })
        .onConflictDoNothing();
    else
      await this.db
        .delete(newcomerWelcomes)
        .where(and(eq(newcomerWelcomes.eventId, eventId), eq(newcomerWelcomes.userId, newcomerId)));
    return this.newcomers(userId, eventId);
  }
}
