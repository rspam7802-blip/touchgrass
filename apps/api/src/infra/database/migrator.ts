import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, PoolClient } from 'pg';

/**
 * Versioned, reversible SQL migrations. Each migration is a directory `NNNN_name/` with `up.sql` and `down.sql`.
 * Runs inside a transaction under an advisory lock so concurrent deploys cannot race.
 */
export const DEFAULT_MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../migrations',
);
const LOCK_ID = 7_407_221_001;

export interface Migration {
  version: string;
  name: string;
  up: string;
  down: string;
  checksum: string;
}

export function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Migration[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^\d{4}_[a-z0-9_]+$/.test(d.name))
    .map((d) => d.name)
    .sort()
    .map((folder) => {
      const upPath = join(dir, folder, 'up.sql');
      const downPath = join(dir, folder, 'down.sql');
      if (!existsSync(upPath) || !existsSync(downPath)) {
        throw new Error(`Migration ${folder} must contain up.sql and down.sql`);
      }
      const up = readFileSync(upPath, 'utf8');
      return {
        version: folder.slice(0, 4),
        name: folder.slice(5),
        up,
        down: readFileSync(downPath, 'utf8'),
        checksum: createHash('sha256').update(up).digest('hex'),
      };
    });
}

async function withLock<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    return await fn(client);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
}

async function applied(client: PoolClient): Promise<Map<string, string>> {
  const { rows } = await client.query<{ version: string; checksum: string }>(
    'SELECT version, checksum FROM schema_migrations',
  );
  return new Map(rows.map((r) => [r.version, r.checksum]));
}

export async function migrateUp(
  pool: Pool,
  migrations: Migration[] = loadMigrations(),
): Promise<string[]> {
  return withLock(pool, async (client) => {
    const done = await applied(client);
    const ran: string[] = [];
    for (const m of migrations) {
      const existing = done.get(m.version);
      if (existing !== undefined) {
        if (existing !== m.checksum)
          throw new Error(`Checksum mismatch for applied migration ${m.version}_${m.name}`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(m.up);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [m.version, m.name, m.checksum],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      ran.push(`${m.version}_${m.name}`);
    }
    return ran;
  });
}

export async function migrateDown(
  pool: Pool,
  steps = 1,
  migrations: Migration[] = loadMigrations(),
): Promise<string[]> {
  return withLock(pool, async (client) => {
    const done = await applied(client);
    const targets = migrations
      .filter((m) => done.has(m.version))
      .reverse()
      .slice(0, steps);
    const reverted: string[] = [];
    for (const m of targets) {
      await client.query('BEGIN');
      try {
        await client.query(m.down);
        await client.query('DELETE FROM schema_migrations WHERE version = $1', [m.version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
      reverted.push(`${m.version}_${m.name}`);
    }
    return reverted;
  });
}
