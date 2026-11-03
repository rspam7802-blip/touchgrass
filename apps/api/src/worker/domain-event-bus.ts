import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';

export const DomainEventJob = z.object({
  eventId: z.uuid(),
  aggregateType: z.string(),
  aggregateId: z.uuid(),
  type: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: z.iso.datetime(),
});
export type DomainEventJob = z.infer<typeof DomainEventJob>;

export type DomainEventHandler = (event: DomainEventJob) => Promise<void>;

/**
 * In-worker dispatch of outbox events to subscribed handlers (badges, notifications, reliability, …).
 * Handlers must be idempotent: BullMQ guarantees at-least-once delivery.
 */
@Injectable()
export class DomainEventBus {
  private readonly logger = new Logger(DomainEventBus.name);
  private readonly handlers = new Map<string, { name: string; fn: DomainEventHandler }[]>();

  subscribe(eventType: string, name: string, fn: DomainEventHandler): void {
    const list = this.handlers.get(eventType) ?? [];
    if (list.some((h) => h.name === name))
      throw new Error(`Handler ${name} already subscribed to ${eventType}`);
    list.push({ name, fn });
    this.handlers.set(eventType, list);
  }

  subscribedTypes(): string[] {
    return [...this.handlers.keys()];
  }

  async dispatch(raw: unknown): Promise<number> {
    const event = DomainEventJob.parse(raw);
    const list = [...(this.handlers.get(event.type) ?? []), ...(this.handlers.get('*') ?? [])];
    const results = await Promise.allSettled(list.map((h) => h.fn(event)));
    const failures = results.flatMap((r, i) =>
      r.status === 'rejected' ? [{ handler: list[i]?.name, reason: r.reason as unknown }] : [],
    );
    if (failures.length > 0) {
      for (const f of failures)
        this.logger.error(
          `handler ${f.handler ?? '?'} failed for ${event.type}: ${String(f.reason)}`,
        );
      throw new Error(`${failures.length} handler(s) failed for event ${event.eventId}`);
    }
    return list.length;
  }
}
