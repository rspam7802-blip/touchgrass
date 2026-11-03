import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { AfterModule } from '../after/after.module.js';
import { BadgesReader } from '../after/badges-reader.js';
import { CitiesModule } from '../cities/cities.module.js';
import { CrewsModule } from '../crews/crews.module.js';
import { EventsModule } from '../events/events.module.js';
import { InterestsModule } from '../interests/interests.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ProfilesModule } from '../profiles/profiles.module.js';
import { SocialGraphModule } from '../social/graph/social-graph.module.js';
import { UsersModule } from '../users/users.module.js';
import { ChallengesService } from './challenges.service.js';
import { GamificationAdminController, GamificationController } from './gamification.controller.js';
import { GamificationHandlers } from './gamification.handlers.js';
import { GamificationService } from './gamification.service.js';
import { RecapsService } from './recaps.service.js';
import { UsersService } from '../users/users.service.js';
import { ActivityService } from '../social/activity/activity.service.js';
import { SocialModule } from '../social/social.module.js';

/** Badges, streaks, challenges and recaps (Phase 8, F-GAM-01..04). */
@Module({
  imports: [
    AccountModule,

    AfterModule,
    CitiesModule,
    CrewsModule,
    EventsModule,
    InterestsModule,
    NotificationsModule,
    ProfilesModule,
    SocialGraphModule,
    SocialModule,
    UsersModule,
  ],
  controllers: [GamificationController, GamificationAdminController],
  providers: [GamificationService, ChallengesService, RecapsService, GamificationHandlers],
  exports: [GamificationService, ChallengesService, RecapsService, GamificationHandlers],
})
export class GamificationModule implements OnModuleInit {
  constructor(
    private readonly gamification: GamificationService,
    private readonly challenges: ChallengesService,
    private readonly recaps: RecapsService,
    private readonly badgesReader: BadgesReader,
    private readonly accountData: AccountDataRegistry,
    private readonly activity: ActivityService,
    private readonly users: UsersService,
  ) {}

  onModuleInit(): void {
    // Badges are public: every viewer sees the name, in their own language.
    this.activity.registerObjectType('badge', async (viewerId, ids) => {
      const [found, langs] = await Promise.all([
        this.gamification.badgesByIds(ids),
        this.users.languages([viewerId]),
      ]);
      const lang = langs.get(viewerId) ?? 'en';
      return new Map([...found].map(([id, b]) => [id, b.name[lang]]));
    });
    this.badgesReader.register({
      earnedAt: (userId, eventId) => this.gamification.earnedAt(userId, eventId),
    });
    this.accountData.register({
      name: 'gamification',
      export: async (userId) => ({
        ...(await this.gamification.exportFor(userId)),
        ...(await this.challenges.exportFor(userId)),
        ...(await this.recaps.exportFor(userId)),
      }),
      erase: async (userId, tx) => {
        await this.challenges.eraseFor(userId, tx);
        await this.recaps.eraseFor(userId, tx);
        await this.gamification.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
