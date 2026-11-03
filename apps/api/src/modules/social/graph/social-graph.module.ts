import { Module } from '@nestjs/common';
import { SocialGraphService } from './social-graph.service.js';

/** Low-level graph module with no dependencies on profiles, so profiles and social can both use it. */
@Module({ providers: [SocialGraphService], exports: [SocialGraphService] })
export class SocialGraphModule {}
