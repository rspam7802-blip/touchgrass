import { Controller, Get, HttpCode, Inject, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AllowOnboarding, Public } from '../../common/auth/decorators.js';
import { HealthResponse } from '@touchgrass/shared';
import type { Response } from 'express';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import { ApiZodResponse } from '../../common/openapi/zod-openapi.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { PG_POOL } from '../../infra/database/database.module.js';
import { REDIS } from '../../infra/redis/redis.module.js';

const PROBE_TIMEOUT_MS = 1500;

/** Resolves 'up'/'down' within a bounded time so a hung dependency cannot hang the health check. */
export async function probe(
  check: Promise<unknown>,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<'up' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'down'>((resolve) => {
    timer = setTimeout(() => {
      resolve('down');
    }, timeoutMs);
  });
  try {
    return await Promise.race([check.then(() => 'up' as const), timeout]);
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

@Public()
@AllowOnboarding()
@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    @Inject(PG_POOL) private readonly pool: pg.Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Liveness: the process is up. Used by the container orchestrator. */
  @Get('live')
  @HttpCode(200)
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Readiness: dependencies reachable. Returns 503 when degraded so the load balancer drains this task. */
  @Get()
  @ApiZodResponse(200, HealthResponse)
  async ready(@Res({ passthrough: true }) res: Response): Promise<HealthResponse> {
    const [db, redis] = await Promise.all([
      probe(this.pool.query('SELECT 1')),
      probe(this.redis.ping()),
    ]);
    const status = db === 'up' && redis === 'up' ? 'ok' : 'degraded';
    if (status !== 'ok') res.status(503);
    return { status, version: this.env.APP_VERSION, checks: { db, redis } };
  }
}
