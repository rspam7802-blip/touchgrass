import { NestFactory } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { RealtimeModule } from '../src/realtime/realtime.module.js';
import { ScheduledJobs } from '../src/worker/scheduled-jobs.js';
import { WorkerModule } from '../src/worker/worker.module.js';
import { integrationEnv } from './helpers.js';

const env = integrationEnv({ STORAGE_PROVIDER: 'memory' });

describe('process wiring', () => {
  it.each([
    ['api', () => AppModule.forRoot(env)],
    ['realtime', () => RealtimeModule.forRoot(env)],
    ['worker', () => WorkerModule.forRoot(env, { autostart: false })],
  ] as const)('%s resolves every dependency', async (_name, mod) => {
    const app = await NestFactory.create(mod(), { abortOnError: false, logger: false });
    await app.close();
  });

  it('the worker schedules every recurring job', async () => {
    const app = await NestFactory.createApplicationContext(
      WorkerModule.forRoot(env, { autostart: false }),
      {
        abortOnError: false,
        logger: false,
      },
    );
    const ids = app
      .get(ScheduledJobs)
      .definitions()
      .map((j) => j.id);
    await app.close();
    expect(ids.sort()).toEqual(
      [
        'account.purge-due',
        'otp.purge-expired',
        'media.purge-stale-uploads',
        'stories.purge-unposted-media',
        'verification.purge-unsubmitted-selfies',
        'stories.purge-expired',
        'events.waitlist-sweep',
        'events.complete-ended',
        'weather.refresh',
        'partitions.maintain',
        'chat.open-event-chats',
        'chat.close-polls',
        'chat.purge-client-ids',
        'payments.expire-holds',
        'payments.retry-refunds',
        'payments.webhook-sweep',
        'payouts.create-due',
        'payouts.execute',
        'reliability.recompute',
        'availability.sweep',
        'crews.generate-sessions',
        'proposals.lock-due',
        'streaks.apply-freezes',
        'streaks.remind',
        'recaps.generate',
        'safety.end-expired-shares',
        'safety.purge-locations',
        'sanctions.lift-expired',
        'notifications.flush-pending',
        'notifications.purge-old',
        'reminders.plans',
        'reminders.mystery-reveals',
        'reminders.prune-log',
        'analytics.prune-active',
      ].sort(),
    );
  });
});
