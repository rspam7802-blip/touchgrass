import { Injectable, Logger } from '@nestjs/common';
import type { ClientAnalyticsBody } from '@touchgrass/shared';
import {
  AnalyticsPiiError,
  type AnalyticsValue,
  AnalyticsSink,
  assertNoPii,
} from '../../adapters/analytics/analytics.port.js';
import { AppError } from '../../common/errors/app-error.js';
import type { DomainEventJob } from '../../worker/domain-event-bus.js';

/** Domain event → product analytics name (F-PLT-05). Anything not listed isn't tracked. */
export const TRACKED_EVENTS: Record<string, string> = {
  'user.signed_up': 'signed_up',
  'user.onboarded': 'onboarded',
  'event.created': 'plan_created',
  'event.cancelled': 'plan_cancelled',
  'rsvp.going': 'pulled_up',
  'rsvp.waitlisted': 'waitlisted',
  'rsvp.cancelled': 'rsvp_cancelled',
  'rsvp.checked_in': 'checked_in',
  'chat.message_created': 'message_sent',
  'friendship.requested': 'squad_requested',
  'friendship.accepted': 'squad_accepted',
  'payment.captured': 'payment_captured',
  'lore.added': 'lore_added',
  'availability.set': 'free_now_set',
  'crew.approved': 'crew_joined',
  'proposal.locked': 'vote_locked',
  'badge.earned': 'badge_earned',
  'challenge.completed': 'challenge_completed',
  'referral.rewarded': 'referral_rewarded',
  'report.created': 'report_created',
  'city.waitlist_joined': 'city_waitlist_joined',
};

/** Who did it: the first person-shaped field in the payload, else the aggregate when it is a user. */
const ACTOR_FIELDS = [
  'userId',
  'senderId',
  'creatorUserId',
  'requesterId',
  'reporterId',
  'referrerId',
  'byUserId',
];
/** Only ids and small enums travel: never names, text, places or contact details. */
const SAFE_FIELDS = [
  'eventId',
  'crewId',
  'proposalId',
  'badgeId',
  'visibility',
  'kind',
  'mode',
  'role',
  'severity',
  'targetType',
  'first',
];

/** Who did it: the first person-shaped field in the payload, else the aggregate when it is a user. */
export function actorOf(e: DomainEventJob): string | null {
  return (
    ACTOR_FIELDS.map((f) => e.payload[f]).find((v): v is string => typeof v === 'string') ??
    (e.aggregateType === 'user' ? e.aggregateId : null)
  );
}

export function toAnalytics(e: DomainEventJob): {
  distinctId: string;
  event: string;
  properties: Record<string, AnalyticsValue>;
} | null {
  const event = TRACKED_EVENTS[e.type];
  if (!event) return null;
  const actor = actorOf(e);
  if (!actor) return null;
  const properties: Record<string, AnalyticsValue> = {};
  for (const f of SAFE_FIELDS) {
    const v = e.payload[f];
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') properties[f] = v;
  }
  return { distinctId: actor, event, properties };
}

/**
 * Product analytics (F-PLT-05): key actions are tracked server-side from domain events, plus a short list of
 * things only the app sees. Every property passes the PII guard; analytics never breaks a request.
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly sink: AnalyticsSink) {}

  async trackDomain(e: DomainEventJob): Promise<boolean> {
    const mapped = toAnalytics(e);
    if (!mapped) return false;
    return this.capture([{ ...mapped, timestamp: new Date(e.occurredAt) }]);
  }

  async trackClient(
    userId: string,
    body: ClientAnalyticsBody,
    now: Date = new Date(),
  ): Promise<number> {
    const events = body.events.map((e) => ({
      distinctId: userId,
      event: e.name,
      properties: { ...e.properties, source: 'app' },
      timestamp: e.at ? new Date(e.at) : now,
    }));
    try {
      for (const e of events) assertNoPii(e.properties);
    } catch (err) {
      if (err instanceof AnalyticsPiiError)
        throw new AppError('VALIDATION_FAILED', err.message, [
          { path: 'events', message: 'No personal data in analytics', code: 'custom' },
        ]);
      throw err;
    }
    return (await this.capture(events)) ? events.length : 0;
  }

  private async capture(
    events: {
      distinctId: string;
      event: string;
      properties: Record<string, AnalyticsValue>;
      timestamp: Date;
    }[],
  ): Promise<boolean> {
    try {
      await this.sink.capture(events);
      return true;
    } catch (err) {
      this.logger.warn(
        `Analytics capture failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
