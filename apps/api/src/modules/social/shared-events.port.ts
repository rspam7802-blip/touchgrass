/**
 * "Pulled up together" signal for suggestions. Implemented by the events module's stats reader
 * (EventSharedEvents); declared here so social never reads event tables.
 */
export abstract class SharedEventsReader {
  abstract sharedEventCounts(userId: string, others: string[]): Promise<Map<string, number>>;
  abstract coAttendees(userId: string, limit: number): Promise<{ id: string; shared: number }[]>;
}
