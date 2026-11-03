import { Module } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module.js';
import { InvitesService } from './invites.service.js';

@Module({ imports: [PlatformModule], providers: [InvitesService], exports: [InvitesService] })
export class InvitesModule {}
