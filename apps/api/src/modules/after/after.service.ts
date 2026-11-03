import { Inject, Injectable } from '@nestjs/common';
import {
  LIMITS,
  type PostEventCard,
  type ReconnectCandidate,
  type ReconnectState,
} from '@touchgrass/shared';
import { and, eq, inArray, or } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { postEventPrompts, reconnectPulls } from '../../infra/database/schema/index.js';
import { EventAccessService } from '../events/event-access.service.js';
import { EventSearchService } from '../events/event-search.service.js';
import { feedbackOpenUntil } from '../feedback/feedback.policy.js';
import { FeedbackService } from '../feedback/feedback.service.js';
import { LoreService } from '../lore/lore.service.js';
import { MediaService } from '../media/media.service.js';
import { PeopleService } from '../profiles/people.service.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';
import { BadgesReader } from './badges-reader.js';

const DAY = 86_400_000;

/** Pure rule (F-AFT-03): what a "people you met" row shows. */
export function reconnectState(
  relationship: 'self' | 'squad' | 'request_sent' | 'request_received' | 'none',
  iPulled: boolean,
  theyPulled: boolean,
): ReconnectState {
  if (relationship === 'squad') return 'squad';
  if (iPulled) return 'pulled';
  if (theyPulled || relationship === 'request_received') return 'pulled_you';
  if (relationship === 'request_sent') return 'request_sent';
  return 'none';
}

/**
 * After the plan (F-AFT-01, F-AFT-03): the post-event card shown on the next app open, the "people you met"
 * list, and the mutual pull. A pull is a squad request; when both people pull (or one pulls and the other
 * accepts), they are squad — the social graph turns a reverse request into an acceptance.
 */
export const RECONNECT_MUTUAL_EVENT = 'reconnect.mutual';

@Injectable()
export class AfterService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly access: EventAccessService,
    private readonly search: EventSearchService,
    private readonly graph: SocialGraphService,
    private readonly people: PeopleService,
    private readonly feedback: FeedbackService,
    private readonly lore: LoreService,
    private readonly media: MediaService,
    private readonly badges: BadgesReader,
    private readonly outbox: OutboxService,
  ) {}

  /** Who attended (checked in or hosted), visible to the viewer only if they attended too. */
  private async attendees(viewerId: string, eventId: string): Promise<string[]> {
    const { facts } = await this.access.visibleOrThrow(viewerId, eventId);
    if (facts.rsvp !== 'checked_in' && facts.hostRole === null)
      throw new AppError('NOT_ELIGIBLE', 'Only people who were there see this', {
        reason: 'NOT_ATTENDED',
      });
    return this.search.checkedInAndHosts(eventId);
  }

  async peopleYouMet(viewerId: string, eventId: string): Promise<ReconnectCandidate[]> {
    const ids = (await this.attendees(viewerId, eventId)).filter((id) => id !== viewerId);
    const blocked = await this.graph.blockedSet(viewerId);
    const others = ids.filter((id) => !blocked.has(id));
    if (others.length === 0) return [];
    const [cards, pulls] = await Promise.all([
      this.people.cards(viewerId, others),
      this.db
        .select()
        .from(reconnectPulls)
        .where(
          and(
            eq(reconnectPulls.eventId, eventId),
            or(eq(reconnectPulls.fromUserId, viewerId), eq(reconnectPulls.toUserId, viewerId)),
          ),
        ),
    ]);
    const out: ReconnectCandidate[] = [];
    for (const id of others) {
      const person = cards.get(id);
      if (!person) continue;
      const relationship = await this.graph.relationshipStatus(viewerId, id);
      out.push({
        person,
        state: reconnectState(
          relationship,
          pulls.some((p) => p.fromUserId === viewerId && p.toUserId === id),
          pulls.some((p) => p.fromUserId === id && p.toUserId === viewerId),
        ),
      });
    }
    return out;
  }

  /** One tap: record the pull and send (or complete) the squad request. */
  async pull(userId: string, eventId: string, targetId: string): Promise<ReconnectState> {
    const attendees = await this.attendees(userId, eventId);
    if (targetId === userId || !attendees.includes(targetId)) throw AppError.notFound('Person');
    if (await this.graph.isBlockedEitherWay(userId, targetId)) throw AppError.notFound('Person');
    await this.db
      .insert(reconnectPulls)
      .values({ eventId, fromUserId: userId, toUserId: targetId })
      .onConflictDoNothing();
    const status = await this.graph.request(userId, targetId);
    if (status !== 'squad') return 'pulled';
    // Only a pull that completes a mutual pull counts as a reconnect (Connector badge, F-GAM-01).
    const [back] = await this.db
      .select({ at: reconnectPulls.createdAt })
      .from(reconnectPulls)
      .where(
        and(
          eq(reconnectPulls.eventId, eventId),
          eq(reconnectPulls.fromUserId, targetId),
          eq(reconnectPulls.toUserId, userId),
        ),
      );
    if (back)
      await this.db.transaction((tx) =>
        this.outbox.add(tx, {
          aggregateType: 'event',
          aggregateId: eventId,
          type: RECONNECT_MUTUAL_EVENT,
          payload: { eventId, userIds: [userId, targetId] },
        }),
      );
    return 'squad';
  }

  /** The post-event card for the most recent plan the person attended and has not dismissed. */
  async pending(userId: string, now: Date = new Date()): Promise<PostEventCard | null> {
    const since = new Date(now.getTime() - LIMITS.after.postEventWindowDays * DAY);
    const ids = await this.search.recentlyAttended(userId, since, now, 10);
    if (ids.length === 0) return null;
    const dismissed = await this.db
      .select({ eventId: postEventPrompts.eventId })
      .from(postEventPrompts)
      .where(and(eq(postEventPrompts.userId, userId), inArray(postEventPrompts.eventId, ids)));
    const done = new Set(dismissed.map((d) => d.eventId));
    const next = ids.find((id) => !done.has(id));
    return next ? this.card(userId, next, now) : null;
  }

  async card(userId: string, eventId: string, now: Date = new Date()): Promise<PostEventCard> {
    const { core, facts } = await this.access.visibleOrThrow(userId, eventId);
    if (facts.rsvp !== 'checked_in')
      throw new AppError('NOT_ELIGIBLE', 'Only people who were there see this', {
        reason: 'NOT_ATTENDED',
      });
    if (now < core.endsAt)
      throw new AppError('NOT_ELIGIBLE', 'Wait until the plan ends', { reason: 'NOT_YET' });
    const hostId = facts.hosts.find((h) => h.role === 'host')?.userId ?? core.creatorUserId;
    const [hostCards, mine, people, lore, badges, coverAsset] = await Promise.all([
      this.people.cards(userId, [hostId]),
      this.feedback.mine(userId, eventId),
      this.peopleYouMet(userId, eventId),
      this.lore.summaryFor(userId, core, facts, now),
      this.badges.earnedAt(userId, eventId),
      core.coverMediaId ? this.media.byId(core.coverMediaId) : Promise.resolve(null),
    ]);
    return {
      event: {
        id: core.id,
        title: core.title,
        startsAt: core.startsAt.toISOString(),
        endsAt: core.endsAt.toISOString(),
        cover:
          coverAsset?.status === 'ready' ? await this.media.urlsFor(coverAsset.variantKeys) : null,
      },
      host: hostCards.get(hostId) ?? null,
      feedback: mine,
      feedbackOpenUntil: feedbackOpenUntil(core.endsAt).toISOString(),
      people,
      loreCount: lore?.count ?? 0,
      canAddLore: lore?.canAdd ?? false,
      badges,
    };
  }

  async dismiss(userId: string, eventId: string): Promise<void> {
    await this.db.insert(postEventPrompts).values({ userId, eventId }).onConflictDoNothing();
  }

  // ---------- account data ----------

  async exportFor(userId: string): Promise<Record<string, unknown>> {
    const pulls = await this.db
      .select()
      .from(reconnectPulls)
      .where(eq(reconnectPulls.fromUserId, userId));
    return {
      reconnectPulls: pulls.map((p) => ({
        eventId: p.eventId,
        toUserId: p.toUserId,
        at: p.createdAt.toISOString(),
      })),
    };
  }

  async eraseFor(userId: string, tx: Tx): Promise<void> {
    await tx
      .delete(reconnectPulls)
      .where(or(eq(reconnectPulls.fromUserId, userId), eq(reconnectPulls.toUserId, userId)));
    await tx.delete(postEventPrompts).where(eq(postEventPrompts.userId, userId));
  }
}
