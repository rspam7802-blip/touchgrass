import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { initTelemetry } from './infra/telemetry/telemetry.js';
import { loadEnv } from './config/env.js';
import { WorkerModule } from './worker/worker.module.js';

initTelemetry('worker');
const env = loadEnv();
const app = await NestFactory.createApplicationContext(WorkerModule.forRoot(env), {
  bufferLogs: true,
});
app.useLogger(app.get(Logger));
app.enableShutdownHooks();
