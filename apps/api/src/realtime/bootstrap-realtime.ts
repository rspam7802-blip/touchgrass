import { type INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from 'nestjs-pino';
import { AllExceptionsFilter } from '../common/errors/all-exceptions.filter.js';
import type { Env } from '../config/env.js';
import { createRedis } from '../infra/redis/redis.module.js';
import { RealtimeModule } from './realtime.module.js';
import { RedisIoAdapter } from './redis-io.adapter.js';

export async function createRealtimeApp(
  env: Env,
  options: { logger?: boolean } = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(RealtimeModule.forRoot(env), {
    bufferLogs: true,
    logger: options.logger === false ? false : undefined,
  });
  if (options.logger !== false) app.useLogger(app.get(Logger));
  // Only health probes are served over HTTP here; every API route lives in the API process (and its guards).
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/v1/health')) {
      next();
      return;
    }
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new AllExceptionsFilter(env.NODE_ENV !== 'production'));
  const pub = createRedis(env.REDIS_URL);
  const sub = pub.duplicate();
  app.useWebSocketAdapter(new RedisIoAdapter(app, pub, sub, env.CORS_ORIGINS));
  app.enableShutdownHooks();
  const close = app.close.bind(app);
  app.close = async () => {
    await close();
    await Promise.all([pub.quit(), sub.quit()]).catch(() => undefined);
  };
  return app;
}
