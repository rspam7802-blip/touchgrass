import 'reflect-metadata';
import cluster from 'node:cluster';
import { initTelemetry } from './infra/telemetry/telemetry.js';
import { loadEnv } from './config/env.js';
import { createApiApp } from './bootstrap.js';

const env = loadEnv();

/**
 * One container can run several API processes (`API_WORKERS`) sharing the port, so a multi-vCPU task uses
 * every core; the API keeps no in-process state that would break with more than one (ARCHITECTURE §2).
 * The primary only supervises: a worker that dies is replaced.
 */
if (env.API_WORKERS > 1 && cluster.isPrimary) {
  let stopping = false;
  for (let i = 0; i < env.API_WORKERS; i += 1) cluster.fork();
  cluster.on('exit', () => {
    if (!stopping) cluster.fork();
  });
  const stop = (): void => {
    stopping = true;
    for (const w of Object.values(cluster.workers ?? {})) w?.kill('SIGTERM');
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
} else {
  initTelemetry('api');
  const app = await createApiApp(env);
  // No host: Node listens on every IPv4 and IPv6 address, so the website can reach the API over Railway's
  // private network (IPv6) and visitors' addresses survive for per-address limits (D-169).
  await app.listen(env.API_PORT);
}
