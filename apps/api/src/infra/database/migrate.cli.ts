import { loadEnv } from '../../config/env.js';
import { migrateDown, migrateUp } from './migrator.js';
import { poolFromEnv } from './database.module.js';

const env = loadEnv();
const pool = poolFromEnv(env, env.DATABASE_URL, 2);
const [direction = 'up', stepsArg] = process.argv.slice(2);

try {
  const result =
    direction === 'down' ? await migrateDown(pool, Number(stepsArg ?? 1)) : await migrateUp(pool);
  process.stdout.write(`${direction}: ${result.length ? result.join(', ') : 'nothing to do'}\n`);
} finally {
  await pool.end();
}
