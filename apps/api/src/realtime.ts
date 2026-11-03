import 'reflect-metadata';
import { initTelemetry } from './infra/telemetry/telemetry.js';
import { loadEnv } from './config/env.js';
import { createRealtimeApp } from './realtime/bootstrap-realtime.js';

initTelemetry('realtime');
const env = loadEnv();
const app = await createRealtimeApp(env);
await app.listen(env.REALTIME_PORT, '0.0.0.0');
