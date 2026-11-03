import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import type pg from 'pg';
import { PG_POOL } from '../database/database.module.js';
import { QUEUE_REGISTRY, type QueueRegistry } from '../queue/queue.module.js';
import { QUEUES } from '../queue/queues.js';

interface OutboxRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: Date;
}

/**
 * Moves committed outbox rows onto the `domain-events` queue. Safe with many worker replicas:
 * rows are claimed with FOR UPDATE SKIP LOCKED, and the BullMQ jobId equals the outbox id so a
 * crash after enqueue but before marking published cannot create a duplicate job.
 */
@Injectable()
export class OutboxRelay implements OnApplicationShutdown {
  private readonly logger = new Logger(OutboxRelay.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(QUEUE_REGISTRY) private readonly queues: QueueRegistry,
  ) {}

  start(intervalMs = 250): void {
    const tick = (): void => {
      this.relayBatch()
        .catch((err: unknown) => {
          this.logger.error(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (this.running) this.timer = setTimeout(tick, intervalMs);
        });
    };
    this.running = true;
    tick();
  }

  async relayBatch(batchSize = 200): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, aggregate_type, aggregate_id, event_type, payload, created_at
           FROM outbox_events WHERE published_at IS NULL
          ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      if (rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }
      const queue = this.queues.get(QUEUES.domainEvents);
      await queue.addBulk(
        rows.map((r) => ({
          name: r.event_type,
          data: {
            eventId: r.id,
            aggregateType: r.aggregate_type,
            aggregateId: r.aggregate_id,
            type: r.event_type,
            payload: r.payload,
            occurredAt: r.created_at.toISOString(),
          },
          opts: { jobId: r.id },
        })),
      );
      await client.query(
        'UPDATE outbox_events SET published_at = now(), attempts = attempts + 1 WHERE id = ANY($1::uuid[])',
        [rows.map((r) => r.id)],
      );
      await client.query('COMMIT');
      return rows.length;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  onApplicationShutdown(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
  }
}
