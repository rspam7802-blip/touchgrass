import { normalizeE164 } from '@touchgrass/shared';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { loadEnv } from '../config/env.js';
import * as schema from '../infra/database/schema/index.js';
import { grantSuperAdmin, seedReference } from './reference.js';

/**
 * Production bootstrap (safe to re-run): reference data only, plus optionally the first super admin.
 *   node dist/seed/bootstrap.cli.js [--super-admin +9198XXXXXXXX]
 */
const args = process.argv.slice(2);
const flag = args.indexOf('--super-admin');
const rawPhone = flag >= 0 ? args[flag + 1] : undefined;
const phone = rawPhone ? normalizeE164(rawPhone) : null;
if (flag >= 0 && !phone) {
  process.stderr.write('--super-admin needs a phone number, e.g. +919812345678\n');
  process.exit(2);
}

const env = loadEnv();
const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
try {
  const db = drizzle(pool, { schema });
  const summary = await db.transaction(async (tx) => {
    const ref = await seedReference(tx);
    const admin = phone ? await grantSuperAdmin(tx, phone) : null;
    return {
      neighbourhoods: ref.hoodIds.length,
      interests: ref.interestIds.length,
      vibeTags: ref.vibeIds.length,
      superAdmin: admin ? { userId: admin.userId, created: admin.created } : null,
    };
  });
  process.stdout.write(`bootstrapped: ${JSON.stringify(summary)}\n`);
} finally {
  await pool.end();
}
