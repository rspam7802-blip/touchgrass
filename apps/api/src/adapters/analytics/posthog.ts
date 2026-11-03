import { type FetchFn, requestJson } from '../http/http-client.js';
import { type AnalyticsEvent, AnalyticsSink, assertNoPii } from './analytics.port.js';

/** PostHog batch capture API. Person profiles are disabled; events are keyed by pseudonymous id only. */
export class PostHogAnalyticsSink extends AnalyticsSink {
  constructor(
    private readonly apiKey: string,
    private readonly host: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    super();
  }

  async capture(events: AnalyticsEvent[]): Promise<void> {
    if (events.length === 0) return;
    for (const e of events) assertNoPii(e.properties);
    await requestJson(this.fetchFn, 'posthog', `${this.host.replace(/\/$/, '')}/batch/`, {
      method: 'POST',
      body: {
        api_key: this.apiKey,
        batch: events.map((e) => ({
          event: e.event,
          distinct_id: e.distinctId,
          properties: { ...e.properties, $process_person_profile: false },
          timestamp: (e.timestamp ?? new Date()).toISOString(),
        })),
      },
    });
  }
}
