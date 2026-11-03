import pg from 'pg';
import { loadEnv } from '../../config/env.js';
import { migrateDown, migrateUp } from './migrator.js';

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
const [direction = 'up', stepsArg] = process.argv.slice(2);

try {
  const result =
    direction === 'down' ? await migrateDown(pool, Number(stepsArg ?? 1)) : await migrateUp(pool);
  process.stdout.write(`${direction}: ${result.length ? result.join(', ') : 'nothing to do'}\n`);
} finally {
  await pool.end();
}
