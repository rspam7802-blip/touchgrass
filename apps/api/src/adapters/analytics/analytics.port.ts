export type AnalyticsValue = string | number | boolean | null;

export interface AnalyticsEvent {
  /** Pseudonymous user id (our UUID), never a phone number or name. */
  distinctId: string;
  event: string;
  properties?: Record<string, AnalyticsValue>;
  timestamp?: Date;
}

/** Property keys that could carry personal data are rejected outright (F-PLT-05). */
const PII_KEY =
  /(phone|email|name|address|lat|lng|lon|location|dob|birth|ip|contact|message|text|bio)/i;
const PII_VALUE = /(\+?\d[\d\s-]{8,}\d|[^\s@]+@[^\s@]+\.[^\s@]+)/;

export class AnalyticsPiiError extends Error {
  constructor(key: string) {
    super(`Analytics property "${key}" looks like personal data`);
    this.name = 'AnalyticsPiiError';
  }
}

export function assertNoPii(properties: Record<string, AnalyticsValue> = {}): void {
  for (const [key, value] of Object.entries(properties)) {
    if (PII_KEY.test(key)) throw new AnalyticsPiiError(key);
    if (typeof value === 'string' && PII_VALUE.test(value)) throw new AnalyticsPiiError(key);
  }
}

export abstract class AnalyticsSink {
  abstract capture(events: AnalyticsEvent[]): Promise<void>;
}

export class NoopAnalyticsSink extends AnalyticsSink {
  capture(events: AnalyticsEvent[]): Promise<void> {
    try {
      for (const e of events) assertNoPii(e.properties);
    } catch (err) {
      return Promise.reject(err instanceof Error ? err : new Error(String(err)));
    }
    return Promise.resolve();
  }
}
