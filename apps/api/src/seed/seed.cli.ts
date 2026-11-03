import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { buildAdapters } from '../adapters/adapters.module.js';
import { loadEnv } from '../config/env.js';
import * as schema from '../infra/database/schema/index.js';
import { seed } from './seed.js';

const env = loadEnv();
// Fake people and plans never go into production; use bootstrap.cli.js there.
if (env.NODE_ENV === 'production') {
  process.stderr.write(
    'The development seed refuses to run in production. Use seed/bootstrap.cli.js.\n',
  );
  process.exit(2);
}
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
try {
  const { storage } = buildAdapters(env);
  await storage.ensureBucket();
  const summary = await seed(drizzle(pool, { schema }), {
    tokenPepper: env.TOKEN_HASH_PEPPER,
    storage,
  });
  process.stdout.write(`seeded: ${JSON.stringify(summary)}\n`);
} finally {
  await pool.end();
}
