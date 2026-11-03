import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { UsersModule } from '../users/users.module.js';
import { AdminTemplatesController } from './admin-templates.controller.js';
import { NotificationsController } from './notifications.controller.js';
import { TemplateOverridesService } from './template-overrides.service.js';
import { NotificationsService } from './notifications.service.js';
import { PushDispatchService } from './push-dispatch.service.js';

/** Notification engine (F-NOT-01): inbox, push delivery with quiet hours and digests, localised templates. */
@Module({
  imports: [AccountModule, UsersModule],
  controllers: [NotificationsController, AdminTemplatesController],
  providers: [PushDispatchService, NotificationsService, TemplateOverridesService],
  exports: [PushDispatchService, NotificationsService],
})
export class NotificationsModule implements OnModuleInit {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.accountData.register({
      name: 'notifications',
      export: (userId) => this.notifications.exportFor(userId),
      erase: async (userId, tx) => {
        await this.notifications.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
