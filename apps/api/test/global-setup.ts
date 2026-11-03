import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrateUp } from '../src/infra/database/migrator.js';
import * as schema from '../src/infra/database/schema/index.js';
import { seed } from '../src/seed/seed.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    redisUrl: string;
    s3Endpoint: string;
    smtpUrl: string;
    mailpitApi: string;
  }
}

/** Starts real PostGIS, Redis, an S3-compatible store and Mailpit once for the integration suite. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [postgres, redis, objectStore, mailpit]: [
    StartedPostgreSqlContainer,
    StartedRedisContainer,
    StartedTestContainer,
    StartedTestContainer,
  ] = await Promise.all([
    new PostgreSqlContainer('postgis/postgis:16-3.4')
      .withDatabase('touchgrass')
      .withUsername('tg')
      .withPassword('tg')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
    new GenericContainer('rustfs/rustfs:1.0.4')
      .withEnvironment({ RUSTFS_ACCESS_KEY: 'touchgrass', RUSTFS_SECRET_KEY: 'touchgrass-secret' })
      .withExposedPorts(9000)
      .withWaitStrategy(Wait.forListeningPorts())
      .start(),
    new GenericContainer('axllent/mailpit:v1.27')
      .withExposedPorts(1025, 8025)
      .withWaitStrategy(Wait.forListeningPorts())
      .start(),
  ]);

  const databaseUrl = postgres.getConnectionUri();
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  await migrateUp(pool);
  await seed(drizzle(pool, { schema }));
  await pool.end();

  project.provide('databaseUrl', databaseUrl);
  project.provide('redisUrl', `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`);
  project.provide(
    's3Endpoint',
    `http://${objectStore.getHost()}:${objectStore.getMappedPort(9000)}`,
  );
  project.provide('smtpUrl', `smtp://${mailpit.getHost()}:${mailpit.getMappedPort(1025)}`);
  project.provide('mailpitApi', `http://${mailpit.getHost()}:${mailpit.getMappedPort(8025)}`);

  return async () => {
    await Promise.all([postgres.stop(), redis.stop(), objectStore.stop(), mailpit.stop()]);
  };
}
