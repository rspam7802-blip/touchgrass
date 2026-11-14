import { AvailabilityHandlers } from '../modules/availability/availability.handlers.js';
import { CrewsHandlers } from '../modules/crews/crews.handlers.js';
import { ProposalsHandlers } from '../modules/proposals/proposals.handlers.js';
import { GamificationHandlers } from '../modules/gamification/gamification.handlers.js';
import { ReferralsHandlers } from '../modules/referrals/referrals.handlers.js';
import { RemindersHandlers } from '../modules/reminders/reminders.handlers.js';
import { AnalyticsCountersService } from '../modules/analytics/analytics-counters.service.js';
import { AnalyticsService, TRACKED_EVENTS } from '../modules/analytics/analytics.service.js';
import {
  type DynamicModule,
  Inject,
  Module,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { type Job, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { coreImports } from '../app.module.js';
import { CommonModule } from '../common/common.module.js';
import type { Env } from '../config/env.js';
import { PartitionService } from '../infra/database/partitions.js';
import { OutboxRelay } from '../infra/outbox/outbox.relay.js';
import {
  QUEUE_CONNECTION,
  QUEUE_REGISTRY,
  type QueueRegistry,
} from '../infra/queue/queue.module.js';
import { QUEUES } from '../infra/queue/queues.js';
import { AccountModule } from '../modules/account/account.module.js';
import { AtEventModule } from '../modules/at-event/at-event.module.js';
import { AfterModule } from '../modules/after/after.module.js';
import { FeedbackModule } from '../modules/feedback/feedback.module.js';
import { LoreModule } from '../modules/lore/lore.module.js';
import { StoriesModule } from '../modules/stories/stories.module.js';
import { EventCommentsModule } from '../modules/event-comments/event-comments.module.js';
import { ReliabilityModule } from '../modules/reliability/reliability.module.js';
import { AvailabilityModule } from '../modules/availability/availability.module.js';
import { CrewsModule } from '../modules/crews/crews.module.js';
import { ProposalsModule } from '../modules/proposals/proposals.module.js';
import { GamificationModule } from '../modules/gamification/gamification.module.js';
import { ReferralsModule } from '../modules/referrals/referrals.module.js';
import { ModerationToolsModule } from '../modules/moderation-tools/moderation-tools.module.js';
import { SafetyModule } from '../modules/safety/safety.module.js';
import { VerificationModule } from '../modules/verification/verification.module.js';
import { AnalyticsModule } from '../modules/analytics/analytics.module.js';
import { CalendarModule } from '../modules/calendar/calendar.module.js';
import { NotificationsModule } from '../modules/notifications/notifications.module.js';
import { RemindersModule } from '../modules/reminders/reminders.module.js';
import { LoreHandlers } from '../modules/lore/lore.handlers.js';
import { EventCommentsHandlers } from '../modules/event-comments/event-comments.handlers.js';
import { ReliabilityHandlers } from '../modules/reliability/reliability.handlers.js';
import { DiscoveryHandlers } from '../modules/discovery/discovery.handlers.js';
import { HostingModule } from '../modules/hosting/hosting.module.js';
import { PaymentsModule } from '../modules/payments/payments.module.js';
import { PerksModule } from '../modules/perks/perks.module.js';
import { AuthModule } from '../modules/auth/auth.module.js';
import { ChatHandlers } from '../modules/chat/chat.handlers.js';
import { ChatModule } from '../modules/chat/chat.module.js';
import { PaymentsHandlers } from '../modules/payments/payments.handlers.js';
import { WebhooksService } from '../modules/payments/webhooks.service.js';
import { EventActivityHandlers } from '../modules/events/event-activity.handlers.js';
import { DiscoveryModule } from '../modules/discovery/discovery.module.js';
import { EventsModule } from '../modules/events/events.module.js';
import { MediaModule } from '../modules/media/media.module.js';
import { MediaProcessor } from '../modules/media/media.processor.js';
import { MEDIA_UPLOADED_EVENT } from '../modules/media/media.service.js';
import { ActivityHandlers } from '../modules/social/activity/activity.handlers.js';
import { SocialModule } from '../modules/social/social.module.js';
import { DomainEventBus } from './domain-event-bus.js';
import { ScheduledJobs } from './scheduled-jobs.js';

export const WORKER_AUTOSTART = Symbol('WORKER_AUTOSTART');

/** BullMQ consumers + outbox relay + scheduled jobs. Feature modules subscribe handlers to the DomainEventBus. */
@Module({})
export class WorkerModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private workers: Worker[] = [];

  constructor(
    private readonly relay: OutboxRelay,
    private readonly bus: DomainEventBus,
    private readonly scheduled: ScheduledJobs,
    private readonly mediaProcessor: MediaProcessor,
    private readonly activityHandlers: ActivityHandlers,
    private readonly eventActivityHandlers: EventActivityHandlers,
    private readonly chatHandlers: ChatHandlers,
    private readonly paymentsHandlers: PaymentsHandlers,
    private readonly loreHandlers: LoreHandlers,
    private readonly eventCommentsHandlers: EventCommentsHandlers,
    private readonly reliabilityHandlers: ReliabilityHandlers,
    private readonly discoveryHandlers: DiscoveryHandlers,
    private readonly availabilityHandlers: AvailabilityHandlers,
    private readonly crewsHandlers: CrewsHandlers,
    private readonly proposalsHandlers: ProposalsHandlers,
    private readonly gamificationHandlers: GamificationHandlers,
    private readonly referralsHandlers: ReferralsHandlers,
    private readonly remindersHandlers: RemindersHandlers,
    private readonly analytics: AnalyticsService,
    private readonly analyticsCounters: AnalyticsCountersService,
    private readonly webhooks: WebhooksService,
    @Inject(QUEUE_CONNECTION) private readonly connection: Redis,
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
    @Inject(WORKER_AUTOSTART) private readonly autostart: boolean,
  ) {}

  static forRoot(env: Env, options: { autostart?: boolean } = {}): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ...coreImports(env, 'worker'),
        CommonModule,
        AccountModule,
        AuthModule,
        MediaModule,
        SocialModule,
        EventsModule,
        DiscoveryModule,
        ChatModule,
        AtEventModule,
        PaymentsModule,
        HostingModule,
        PerksModule,
        FeedbackModule,
        LoreModule,
        StoriesModule,
        EventCommentsModule,
        AfterModule,
        ReliabilityModule,
        AvailabilityModule,
        CrewsModule,
        ProposalsModule,
        GamificationModule,
        ReferralsModule,
        VerificationModule,
        SafetyModule,
        ModerationToolsModule,
        NotificationsModule,
        RemindersModule,
        CalendarModule,
        AnalyticsModule,
      ],
      providers: [
        DomainEventBus,
        ScheduledJobs,
        PartitionService,
        { provide: WORKER_AUTOSTART, useValue: options.autostart ?? true },
      ],
      exports: [DomainEventBus, ScheduledJobs],
    };
  }

  /** Wires domain event handlers. Separate from start-up so tests can dispatch without consumers running. */
  registerHandlers(): void {
    if (this.bus.subscribedTypes().includes(MEDIA_UPLOADED_EVENT)) return;
    this.bus.subscribe(MEDIA_UPLOADED_EVENT, 'media.process', async (e) => {
      await this.mediaProcessor.process(String(e.payload.assetId));
    });
    this.activityHandlers.registerOn(this.bus);
    this.eventActivityHandlers.registerOn(this.bus);
    this.chatHandlers.registerOn(this.bus);
    this.paymentsHandlers.registerOn(this.bus);
    this.loreHandlers.registerOn(this.bus);
    this.eventCommentsHandlers.registerOn(this.bus);
    this.reliabilityHandlers.registerOn(this.bus);
    this.discoveryHandlers.registerOn(this.bus);
    this.availabilityHandlers.registerOn(this.bus);
    this.crewsHandlers.registerOn(this.bus);
    this.proposalsHandlers.registerOn(this.bus);
    this.gamificationHandlers.registerOn(this.bus);
    this.referralsHandlers.registerOn(this.bus);
    this.remindersHandlers.registerOn(this.bus);
    for (const type of Object.keys(TRACKED_EVENTS))
      this.bus.subscribe(type, 'analytics.track', async (e) => {
        await this.analytics.trackDomain(e);
        // The admin overview's counters (counted once per outbox event).
        await this.analyticsCounters.record(e);
      });
  }

  async onApplicationBootstrap(): Promise<void> {
    this.registerHandlers();
    if (!this.autostart) return;
    this.relay.start();
    this.workers.push(
      new Worker(QUEUES.domainEvents, async (job) => this.bus.dispatch(job.data), {
        connection: this.connection,
        concurrency: 16,
      }),
    );
    this.workers.push(
      new Worker(
        QUEUES.webhooks,
        async (job: Job<{ id: string }>) => this.webhooks.process(job.data.id),
        { connection: this.connection, concurrency: 8 },
      ),
    );
    const scheduledQueue = this.queues.get(QUEUES.scheduled);
    for (const job of this.scheduled.definitions()) {
      await scheduledQueue.upsertJobScheduler(
        job.id,
        { pattern: job.pattern, tz: 'Asia/Kolkata' },
        { name: job.id },
      );
    }
    this.workers.push(
      new Worker(QUEUES.scheduled, async (job) => this.scheduled.run(job.name), {
        connection: this.connection,
        concurrency: 1,
      }),
    );
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
  }
}
