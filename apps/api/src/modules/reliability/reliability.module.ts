import { Module, type OnModuleInit } from '@nestjs/common';
import { AccountDataRegistry } from '../account/account-data.registry.js';
import { AccountModule } from '../account/account.module.js';
import { EventsModule } from '../events/events.module.js';
import { ReliabilityHandlers } from './reliability.handlers.js';
import { ReliabilityReaderModule } from './reliability-reader.js';
import { ReliabilityService } from './reliability.service.js';

/** Reliability score (Phase 7, F-SAF-02). Readers live in `ReliabilityReaderModule` (no dependencies). */
@Module({
  imports: [AccountModule, EventsModule, ReliabilityReaderModule],
  providers: [ReliabilityService, ReliabilityHandlers],
  exports: [ReliabilityService, ReliabilityHandlers],
})
export class ReliabilityModule implements OnModuleInit {
  constructor(
    private readonly reliability: ReliabilityService,
    private readonly accountData: AccountDataRegistry,
  ) {}

  onModuleInit(): void {
    this.accountData.register({
      name: 'reliability',
      export: (userId) => this.reliability.exportFor(userId),
      erase: async (userId, tx) => {
        await this.reliability.eraseFor(userId, tx);
        return undefined;
      },
    });
  }
}
