// Boots the real API for web e2e: a fresh `<db>_e2e` database on the docker-compose Postgres and an emptied
// Redis database of its own (so every run starts from the same seeded state, as in CI, caches can't carry
// values over from another database, and the dev data is never touched), migrate + seed it, then serve on
// API_E2E_PORT.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import pg from 'pg';

const apiDir = resolve(import.meta.dirname, '../../api');
const envFile = resolve(import.meta.dirname, '../../../.env');
const envArgs = existsSync(envFile) ? [`--env-file=${envFile}`] : [];

function envValue(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(envFile)) return undefined;
  const line = readFileSync(envFile, 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${key}=`));
  return line?.slice(key.length + 1).trim();
}

const baseUrl = new URL(
  envValue('DATABASE_URL') ?? 'postgres://touchgrass:touchgrass@localhost:5432/touchgrass',
);
const e2eName = `${baseUrl.pathname.slice(1)}_e2e`;
if (!/^[a-z0-9_]+$/.test(e2eName)) throw new Error(`Unexpected database name ${e2eName}`);
const admin = new pg.Client({ connectionString: new URL('/postgres', baseUrl).toString() });
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${e2eName} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${e2eName}`);
await admin.end();
const DATABASE_URL = new URL(`/${e2eName}`, baseUrl).toString();

// Redis database 15 is reserved for e2e; the dev stack uses database 0.
const redisUrl = new URL(envValue('REDIS_URL') ?? 'redis://localhost:6379');
redisUrl.pathname = '/15';
const REDIS_URL = redisUrl.toString();
const { Redis } = createRequire(resolve(apiDir, 'package.json'))('ioredis');
const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1 });
await redis.flushdb();
await redis.quit();

const run = (script) =>
  execFileSync('node', [...envArgs, script], {
    cwd: apiDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL, REDIS_URL },
  });

run('dist/infra/database/migrate.cli.js');
run('dist/seed/seed.cli.js');
const api = spawn('node', [...envArgs, 'dist/main.js'], {
  cwd: apiDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL,
    REDIS_URL,
    API_PORT: process.env.API_E2E_PORT ?? '4100',
    LOG_LEVEL: 'warn',
    STORAGE_PROVIDER: 'memory',
    // API-driven e2e sign-ins send their own X-Forwarded-For so per-IP OTP limits don't couple tests.
    TRUST_PROXY_HOPS: '1',
  },
});
const stop = () => api.kill('SIGTERM');
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
api.on('exit', (code) => process.exit(code ?? 0));
