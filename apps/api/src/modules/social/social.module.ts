import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { MediaModule } from '../media/media.module.js';
import { ModerationModule } from '../moderation/moderation.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { UsersModule } from '../users/users.module.js';
import { UsersService } from '../users/users.service.js';
import { ActivityHandlers } from './activity/activity.handlers.js';
import { ActivityService } from './activity/activity.service.js';
import { SocialGraphModule } from './graph/social-graph.module.js';
import { SocialGraphService } from './graph/social-graph.service.js';
import { ReportTargetRegistry } from './reports/report-targets.registry.js';
import { ReportsService } from './reports/reports.service.js';
import { EventStatsModule } from '../events/stats/event-stats.module.js';
import { EventSharedEvents } from '../events/stats/event-stats.service.js';
import { SharedEventsReader } from './shared-events.port.js';
import { ActivityController, ReportsController, SocialController } from './social.controller.js';
import { SocialService } from './social.service.js';

/** Squad, contacts, suggestions, blocks, reports and activity (Phase 2, F-SOC-01..05). */
@Module({
  imports: [
    SocialGraphModule,
    ProfilesModule,
    UsersModule,
    MediaModule,
    ModerationModule,
    AccountModule,
    EventStatsModule,
  ],
  controllers: [SocialController, ReportsController, ActivityController],
  providers: [
    SocialService,
    ReportsService,
    ReportTargetRegistry,
    ActivityService,
    ActivityHandlers,
    { provide: SharedEventsReader, useExisting: EventSharedEvents },
  ],
  exports: [
    ReportTargetRegistry,
    ReportsService,
    ActivityService,
    ActivityHandlers,
    SharedEventsReader,
  ],
})
export class SocialModule implements OnModuleInit {
  constructor(
    private readonly targets: ReportTargetRegistry,
    private readonly users: UsersService,
    private readonly graph: SocialGraphService,
    private readonly reports: ReportsService,
    private readonly activity: ActivityService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.targets.register({
      type: 'user',
      // Blocks are deliberately not checked: blocking someone must never stop you reporting them.
      resolve: async (_reporterId, targetId) => {
        const user = await this.users.findById(targetId);
        if (!user || user.status === 'deleted') return null;
        return { cityId: user.cityId, ownerUserId: user.id };
      },
    });
    this.accountData.register({
      name: 'social',
      export: async (userId) => ({
        ...(await this.graph.exportFor(userId)),
        reportsMade: await this.reports.exportFor(userId),
      }),
      erase: async (userId, tx) => {
        await this.graph.eraseFor(userId, tx);
        await this.activity.eraseFor(userId, tx);
        await this.reports.detachReporter(userId, tx);
        return undefined;
      },
    });
  }
}
