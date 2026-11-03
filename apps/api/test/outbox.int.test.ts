import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import pg from 'pg';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DB, type Database } from '../src/infra/database/database.module.js';
import { OutboxRelay } from '../src/infra/outbox/outbox.relay.js';
import { OutboxService } from '../src/infra/outbox/outbox.service.js';
import { QUEUES } from '../src/infra/queue/queues.js';
import { DomainEventBus, type DomainEventJob } from '../src/worker/domain-event-bus.js';
import { WorkerModule } from '../src/worker/worker.module.js';
import { integrationEnv } from './helpers.js';

describe('transactional outbox → BullMQ → domain event handlers', () => {
  const env = integrationEnv();
  let ctx: INestApplicationContext;
  let db: Database;
  let pool: pg.Pool;
  let redis: Redis;
  let queue: Queue;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
    redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue(QUEUES.domainEvents, { connection: redis });
    await queue.obliterate({ force: true });
    await pool.query('DELETE FROM outbox_events');
    ctx = await NestFactory.createApplicationContext(
      WorkerModule.forRoot(env, { autostart: false }),
      { logger: false },
    );
    db = ctx.get<Database>(DB);
  });
  afterAll(async () => {
    await ctx.close();
    await queue.close();
    await redis.quit();
    await pool.end();
  });

  const unpublished = async (): Promise<number> =>
    Number(
      (
        await pool.query<{ n: string }>(
          'SELECT count(*) AS n FROM outbox_events WHERE published_at IS NULL',
        )
      ).rows[0]?.n,
    );

  it('writes events only when the surrounding transaction commits', async () => {
    const outbox = ctx.get(OutboxService);
    await expect(
      db.transaction(async (tx) => {
        await outbox.add(tx, {
          aggregateType: 'event',
          aggregateId: uuidv7(),
          type: 'rsvp.created',
          payload: { n: 1 },
        });
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect(await unpublished()).toBe(0);

    await db.transaction(async (tx) => {
      await outbox.add(tx, {
        aggregateType: 'event',
        aggregateId: uuidv7(),
        type: 'rsvp.created',
        payload: { n: 2 },
      });
    });
    expect(await unpublished()).toBe(1);
  });

  it('relays each event exactly once even with concurrent relays', async () => {
    const outbox = ctx.get(OutboxService);
    await db.transaction(async (tx) => {
      for (let i = 0; i < 40; i += 1) {
        await outbox.add(tx, {
          aggregateType: 'event',
          aggregateId: uuidv7(),
          type: 'checkin.recorded',
          payload: { i },
        });
      }
    });
    const relay = ctx.get(OutboxRelay);
    const counts = await Promise.all([
      relay.relayBatch(15),
      relay.relayBatch(15),
      relay.relayBatch(15),
      relay.relayBatch(15),
    ]);
    let total = counts.reduce((a, b) => a + b, 0);
    while ((await unpublished()) > 0) total += await relay.relayBatch(50);
    expect(total).toBe(41);
    expect(await queue.getJobCountByTypes('waiting', 'delayed', 'active', 'prioritized')).toBe(41);
    expect(await relay.relayBatch()).toBe(0);
  });

  it('dispatches to subscribed handlers and surfaces handler failures for retry', async () => {
    const bus = ctx.get(DomainEventBus);
    const seen: DomainEventJob[] = [];
    bus.subscribe('checkin.recorded', 'test-collector', (e) => {
      seen.push(e);
      return Promise.resolve();
    });
    expect(() => {
      bus.subscribe('checkin.recorded', 'test-collector', () => Promise.resolve());
    }).toThrow(/already subscribed/);
    const job = (await queue.getJobs(['waiting'], 0, 0))[0];
    expect(await bus.dispatch(job?.data)).toBe(1);
    expect(seen[0]?.type).toBe('checkin.recorded');
    expect(bus.subscribedTypes()).toContain('checkin.recorded');

    bus.subscribe('*', 'flaky', () => Promise.reject(new Error('boom')));
    await expect(bus.dispatch(job?.data)).rejects.toThrow(/1 handler\(s\) failed/);
    await expect(bus.dispatch({ nonsense: true })).rejects.toThrow();
  });
});

describe('worker process wiring', () => {
  it('autostarts the relay and a consumer that processes outbox events end to end', async () => {
    const env = integrationEnv();
    const ctx = await NestFactory.createApplicationContext(
      WorkerModule.forRoot(env, { autostart: true }),
      { logger: false },
    );
    const bus = ctx.get(DomainEventBus);
    const received = new Promise<DomainEventJob>((resolve) => {
      bus.subscribe('e2e.ping', 'e2e', (e) => {
        resolve(e);
        return Promise.resolve();
      });
    });
    const id = uuidv7();
    await ctx.get<Database>(DB).transaction(async (tx) => {
      await ctx.get(OutboxService).add(tx, {
        aggregateType: 'probe',
        aggregateId: id,
        type: 'e2e.ping',
        payload: { ok: true },
      });
    });
    const event = await received;
    expect(event).toMatchObject({ aggregateId: id, payload: { ok: true } });
    await ctx.close();
  });
});
