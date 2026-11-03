import { type ClientAnalyticsEventName, LIMITS } from '@touchgrass/shared';
import { useCallback } from 'react';
import { z } from 'zod';
import type { ApiClient } from '../../lib/api-client';
import { useApi } from '../../providers/api-context';

type Props = Record<string, string | number | boolean | null>;
interface Queued {
  name: ClientAnalyticsEventName;
  at: string;
  properties: Props;
}

const Accepted = z.object({ accepted: z.number().int() });
const FLUSH_MS = 5_000;

/**
 * App-side analytics (F-PLT-05): a few allow-listed events, batched and sent in the background. Never
 * personal data (the server rejects it too); losing an event is fine, slowing the app down is not.
 */
class AnalyticsQueue {
  private queue: Queued[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly client: () => ApiClient | null) {}

  track(name: ClientAnalyticsEventName, properties: Props = {}): void {
    this.queue.push({ name, at: new Date().toISOString(), properties });
    if (this.queue.length >= LIMITS.analytics.maxClientEvents) void this.flush();
    else this.timer ??= setTimeout(() => void this.flush(), FLUSH_MS);
  }

  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const client = this.client();
    const batch = this.queue.splice(0, LIMITS.analytics.maxClientEvents);
    if (!client || batch.length === 0) return;
    try {
      await client.request('/v1/analytics/events', Accepted, {
        method: 'POST',
        body: { events: batch },
      });
    } catch {
      // Analytics is best effort.
    }
  }
}

let current: ApiClient | null = null;
export const analytics = new AnalyticsQueue(() => current);

/** `track(name, props)` bound to the signed-in API client. */
export function useTrack(): (name: ClientAnalyticsEventName, properties?: Props) => void {
  const { client } = useApi();
  current = client;
  return useCallback((name, properties) => {
    analytics.track(name, properties);
  }, []);
}
