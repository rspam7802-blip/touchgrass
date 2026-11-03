import { Injectable, Logger } from '@nestjs/common';
import { AccountService } from '../modules/account/account.service.js';
import { OtpService } from '../modules/auth/otp.service.js';
import { AtEventService } from '../modules/at-event/at-event.service.js';
import { ChatPollsService } from '../modules/chat/chat-polls.service.js';
import { ChatService } from '../modules/chat/chat.service.js';
import { WeatherService } from '../modules/discovery/weather.service.js';
import { EventsService } from '../modules/events/events.service.js';
import { PartitionService } from '../infra/database/partitions.js';
import { WaitlistService } from '../modules/events/waitlist.service.js';
import { MediaService } from '../modules/media/media.service.js';
import { ReliabilityService } from '../modules/reliability/reliability.service.js';
import { AvailabilityService } from '../modules/availability/availability.service.js';
import { CrewsService } from '../modules/crews/crews.service.js';
import { ProposalsService } from '../modules/proposals/proposals.service.js';
import { GamificationService } from '../modules/gamification/gamification.service.js';
import { GamificationHandlers } from '../modules/gamification/gamification.handlers.js';
import { RecapsService } from '../modules/gamification/recaps.service.js';
import { PaymentsService } from '../modules/payments/payments.service.js';
import { PayoutsService } from '../modules/payments/payouts.service.js';
import { RefundsService } from '../modules/payments/refunds.service.js';
import { WebhooksService } from '../modules/payments/webhooks.service.js';
import { SanctionsService } from '../modules/moderation-tools/sanctions.service.js';
import { SafetyService } from '../modules/safety/safety.service.js';
import { NotificationsService } from '../modules/notifications/notifications.service.js';
import { RemindersService } from '../modules/reminders/reminders.service.js';
import { AnalyticsCountersService } from '../modules/analytics/analytics-counters.service.js';

export interface ScheduledJob {
  id: string;
  /** Cron pattern evaluated in Asia/Kolkata. */
  pattern: string;
  run: () => Promise<number>;
}

/** Recurring housekeeping. Registered as BullMQ job schedulers, so exactly one replica runs each tick. */
@Injectable()
export class ScheduledJobs {
  private readonly logger = new Logger(ScheduledJobs.name);

  constructor(
    private readonly account: AccountService,
    private readonly otp: OtpService,
    private readonly media: MediaService,
    private readonly events: EventsService,
    private readonly waitlist: WaitlistService,
    private readonly weather: WeatherService,
    private readonly partitions: PartitionService,
    private readonly chat: ChatService,
    private readonly chatPolls: ChatPollsService,
    private readonly atEvent: AtEventService,
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly payouts: PayoutsService,
    private readonly webhooks: WebhooksService,
    private readonly reliability: ReliabilityService,
    private readonly availability: AvailabilityService,
    private readonly crews: CrewsService,
    private readonly proposals: ProposalsService,
    private readonly gamification: GamificationService,
    private readonly gamificationHandlers: GamificationHandlers,
    private readonly recaps: RecapsService,
    private readonly safety: SafetyService,
    private readonly sanctions: SanctionsService,
    private readonly notifications: NotificationsService,
    private readonly reminders: RemindersService,
    private readonly analyticsCounters: AnalyticsCountersService,
  ) {}

  definitions(): ScheduledJob[] {
    return [
      { id: 'account.purge-due', pattern: '17 3 * * *', run: () => this.account.purgeDue() },
      { id: 'otp.purge-expired', pattern: '7 * * * *', run: () => this.otp.purgeExpired() },
      {
        id: 'media.purge-stale-uploads',
        pattern: '37 * * * *',
        run: () => this.media.purgeStaleUploads(),
      },
      { id: 'events.waitlist-sweep', pattern: '* * * * *', run: () => this.waitlist.sweep() },
      {
        id: 'events.complete-ended',
        pattern: '*/5 * * * *',
        run: () => this.events.completeEnded(),
      },
      { id: 'weather.refresh', pattern: '3 * * * *', run: () => this.weather.refreshAll() },
      { id: 'partitions.maintain', pattern: '23 2 * * *', run: () => this.partitions.maintain() },
      {
        id: 'chat.open-event-chats',
        pattern: '*/10 * * * *',
        run: () => this.atEvent.openEventChats(),
      },
      { id: 'chat.close-polls', pattern: '*/2 * * * *', run: () => this.chatPolls.closeDue() },
      {
        id: 'chat.purge-client-ids',
        pattern: '41 3 * * *',
        run: () => this.chat.purgeClientIds(),
      },
      { id: 'payments.expire-holds', pattern: '* * * * *', run: () => this.payments.expireHolds() },
      { id: 'payments.retry-refunds', pattern: '*/5 * * * *', run: () => this.refunds.retryDue() },
      { id: 'payments.webhook-sweep', pattern: '*/5 * * * *', run: () => this.webhooks.sweep() },
      { id: 'payouts.create-due', pattern: '19 * * * *', run: () => this.payouts.createDue() },
      { id: 'payouts.execute', pattern: '*/15 * * * *', run: () => this.payouts.executeDue() },
      {
        id: 'reliability.recompute',
        pattern: '47 3 * * *',
        run: () => this.reliability.recomputeAll(),
      },
      { id: 'availability.sweep', pattern: '29 * * * *', run: () => this.availability.sweep() },
      { id: 'crews.generate-sessions', pattern: '13 * * * *', run: () => this.crews.generateDue() },
      { id: 'proposals.lock-due', pattern: '* * * * *', run: () => this.proposals.lockDue() },
      // Monday just after midnight IST: last week is over, so a freeze can save a live streak.
      {
        id: 'streaks.apply-freezes',
        pattern: '43 0 * * 1',
        run: () => this.gamification.applyFreezes(),
      },
      // Saturday evening, well outside quiet hours.
      {
        id: 'streaks.remind',
        pattern: '7 18 * * 6',
        run: () => this.gamificationHandlers.remindStreaks(),
      },
      { id: 'recaps.generate', pattern: '7 9 1 * *', run: () => this.recaps.generateDue() },
      {
        id: 'safety.end-expired-shares',
        pattern: '* * * * *',
        run: () => this.safety.endExpired(),
      },
      // Hourly with an hour's margin: no location point is kept beyond 24 hours (F-SAF-04).
      { id: 'safety.purge-locations', pattern: '11 * * * *', run: () => this.safety.purge() },
      {
        id: 'sanctions.lift-expired',
        pattern: '*/5 * * * *',
        run: () => this.sanctions.liftExpired(),
      },
      {
        id: 'notifications.flush-pending',
        pattern: '* * * * *',
        run: () => this.notifications.flushPending(),
      },
      {
        id: 'notifications.purge-old',
        pattern: '53 3 * * *',
        run: () => this.notifications.purgeOld(),
      },
      { id: 'reminders.plans', pattern: '*/5 * * * *', run: () => this.reminders.remindPlans() },
      {
        id: 'reminders.mystery-reveals',
        pattern: '*/5 * * * *',
        run: () => this.reminders.announceReveals(),
      },
      { id: 'reminders.prune-log', pattern: '59 3 * * *', run: () => this.reminders.prune() },
      {
        id: 'analytics.prune-active',
        pattern: '17 4 * * *',
        run: () => this.analyticsCounters.pruneActive(),
      },
    ];
  }

  async run(id: string): Promise<number> {
    const job = this.definitions().find((j) => j.id === id);
    if (!job) throw new Error(`Unknown scheduled job ${id}`);
    const affected = await job.run();
    this.logger.log(`${id}: ${affected} affected`);
    return affected;
  }
}
