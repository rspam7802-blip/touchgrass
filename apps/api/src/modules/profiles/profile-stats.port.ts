import type { ProfileStats } from '@touchgrass/shared';

/**
 * Attendance stats and reliability tier shown on profiles. Implemented by the events module's stats reader
 * (EventProfileStats); declared here so profiles never reads event tables.
 */
export abstract class ProfileStatsReader {
  abstract statsFor(userIds: string[]): Promise<Map<string, ProfileStats>>;
}
