import { type DynamicModule, Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AdaptersModule, type AdapterInstances } from './adapters/adapters.module.js';
import { CommonModule } from './common/common.module.js';
import { loggerParams } from './common/logging/logger.config.js';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { DatabaseModule } from './infra/database/database.module.js';
import { OutboxModule } from './infra/outbox/outbox.module.js';
import { QueueModule } from './infra/queue/queue.module.js';
import { RealtimePublisherModule } from './infra/realtime/realtime-publisher.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { AccountModule } from './modules/account/account.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AtEventModule } from './modules/at-event/at-event.module.js';
import { AfterModule } from './modules/after/after.module.js';
import { FeedbackModule } from './modules/feedback/feedback.module.js';
import { LoreModule } from './modules/lore/lore.module.js';
import { StoriesModule } from './modules/stories/stories.module.js';
import { EventCommentsModule } from './modules/event-comments/event-comments.module.js';
import { ReliabilityModule } from './modules/reliability/reliability.module.js';
import { AvailabilityModule } from './modules/availability/availability.module.js';
import { CrewsModule } from './modules/crews/crews.module.js';
import { ProposalsModule } from './modules/proposals/proposals.module.js';
import { GamificationModule } from './modules/gamification/gamification.module.js';
import { ReferralsModule } from './modules/referrals/referrals.module.js';
import { ModerationToolsModule } from './modules/moderation-tools/moderation-tools.module.js';
import { SafetyModule } from './modules/safety/safety.module.js';
import { VerificationModule } from './modules/verification/verification.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { CalendarModule } from './modules/calendar/calendar.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { RemindersModule } from './modules/reminders/reminders.module.js';
import { HostingModule } from './modules/hosting/hosting.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { PerksModule } from './modules/perks/perks.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { ChatModule } from './modules/chat/chat.module.js';
import { CitiesModule } from './modules/cities/cities.module.js';
import { DiscoveryModule } from './modules/discovery/discovery.module.js';
import { EventsModule } from './modules/events/events.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { InterestsModule } from './modules/interests/interests.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { ProfilesModule } from './modules/profiles/profiles.module.js';
import { SocialModule } from './modules/social/social.module.js';
import { PlatformModule } from './modules/platform/platform.module.js';
import { VenuesModule } from './modules/venues/venues.module.js';
import { WaitlistModule } from './modules/waitlist/waitlist.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';

/** Infrastructure shared by all three processes (api, realtime, worker). */
export function coreImports(
  env: Env,
  service: 'api' | 'realtime' | 'worker',
  adapterOverrides: Partial<AdapterInstances> = {},
) {
  return [
    ConfigModule.forRoot(env),
    LoggerModule.forRoot(loggerParams(env, service)),
    DatabaseModule,
    RedisModule,
    QueueModule,
    OutboxModule,
    RealtimePublisherModule,
    AdaptersModule.forRoot(env, adapterOverrides),
  ];
}

/** The REST API (modular monolith). Feature modules are added here phase by phase. */
@Module({})
export class AppModule {
  static forRoot(env: Env, adapterOverrides: Partial<AdapterInstances> = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ...coreImports(env, 'api', adapterOverrides),
        CommonModule,
        HealthModule,
        PlatformModule,
        AuthModule,
        AccountModule,
        ProfilesModule,
        CitiesModule,
        InterestsModule,
        MediaModule,
        AdminModule,
        SocialModule,
        VenuesModule,
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
        WaitlistModule,
        CustomersModule,
      ],
    };
  }
}
