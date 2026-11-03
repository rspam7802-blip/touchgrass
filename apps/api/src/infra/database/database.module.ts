import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import * as schema from './schema/index.js';

export type Database = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Primary (read/write) and replica (read-only: feeds, search) connections. Replica falls back to primary. */
export const DB = Symbol('DB');
export const DB_REPLICA = Symbol('DB_REPLICA');
export const PG_POOL = Symbol('PG_POOL');
export const PG_REPLICA_POOL = Symbol('PG_REPLICA_POOL');

export function createPool(connectionString: string, max: number): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
  });
  pool.on('error', () => undefined);
  return pool;
}

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [ENV],
      useFactory: (env: Env) => createPool(env.DATABASE_URL, env.DATABASE_POOL_MAX),
    },
    {
      provide: PG_REPLICA_POOL,
      inject: [ENV, PG_POOL],
      useFactory: (env: Env, primary: pg.Pool) =>
        env.DATABASE_REPLICA_URL
          ? createPool(env.DATABASE_REPLICA_URL, env.DATABASE_POOL_MAX)
          : primary,
    },
    {
      provide: DB,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool): Database => drizzle(pool, { schema }),
    },
    {
      provide: DB_REPLICA,
      inject: [PG_REPLICA_POOL],
      useFactory: (pool: pg.Pool): Database => drizzle(pool, { schema }),
    },
  ],
  exports: [DB, DB_REPLICA, PG_POOL, PG_REPLICA_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(PG_REPLICA_POOL) private readonly replica: pg.Pool,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
    if (this.replica !== this.pool) await this.replica.end();
  }
}
