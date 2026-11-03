import { type DynamicModule, Module } from '@nestjs/common';
import { coreImports } from '../app.module.js';
import { CommonModule } from '../common/common.module.js';
import type { Env } from '../config/env.js';
import { ChatModule } from '../modules/chat/chat.module.js';
import { HealthModule } from '../modules/health/health.module.js';
import { ProfilesModule } from '../modules/profiles/profiles.module.js';
import { ChatGateway } from './chat.gateway.js';
import { EventsGateway } from './events.gateway.js';

/**
 * Socket.IO gateway process. It loads the chat module for membership checks; its HTTP surface is limited to
 * health probes by `createRealtimeApp` (feature controllers are not served here).
 */
@Module({})
export class RealtimeModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: RealtimeModule,
      imports: [
        ...coreImports(env, 'realtime'),
        CommonModule,
        HealthModule,
        ChatModule,
        ProfilesModule,
      ],
      providers: [ChatGateway, EventsGateway],
    };
  }
}
