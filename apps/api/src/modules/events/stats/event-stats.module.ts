import { Module } from '@nestjs/common';
import { HostEventStats } from './host-event-stats.service.js';
import { ReliabilityReaderModule } from '../../reliability/reliability-reader.js';
import { EventProfileStats, EventSharedEvents } from './event-stats.service.js';

/**
 * Read-only attendance queries over the events module's own tables, with no module dependencies, so
 * profiles and social can consume them (through their ports) without an import cycle.
 */
@Module({
  imports: [ReliabilityReaderModule],
  providers: [EventProfileStats, EventSharedEvents, HostEventStats],
  exports: [EventProfileStats, EventSharedEvents, HostEventStats],
})
export class EventStatsModule {}
