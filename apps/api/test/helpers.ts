import { inject } from 'vitest';
import type { Env } from '../src/config/env.js';
import { testEnv } from '../src/test-support/env.js';

/** Env pointing at the Testcontainers services started in global-setup. */
export function integrationEnv(overrides: Record<string, string> = {}): Env {
  return testEnv({
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: inject('redisUrl'),
    S3_ENDPOINT: inject('s3Endpoint'),
    S3_ACCESS_KEY_ID: 'touchgrass',
    S3_SECRET_ACCESS_KEY: 'touchgrass-secret',
    S3_FORCE_PATH_STYLE: 'true',
    SMTP_URL: inject('smtpUrl'),
    ...overrides,
  });
}
