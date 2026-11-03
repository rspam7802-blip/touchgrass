import type * as Dto from '@touchgrass/shared';
import {
  Body,
  Controller,
  HttpCode,
  type INestApplication,
  Module,
  Post,
  Query,
  Get,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PaginationQuery } from '@touchgrass/shared';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Public } from '../src/common/auth/decorators.js';
import { CommonModule } from '../src/common/common.module.js';
import { DatabaseModule } from '../src/infra/database/database.module.js';
import { AllExceptionsFilter } from '../src/common/errors/all-exceptions.filter.js';
import { AppError } from '../src/common/errors/app-error.js';
import { Idempotent } from '../src/common/idempotency/idempotency.js';
import { RateLimit } from '../src/common/rate-limit/rate-limit.decorator.js';
import { RateLimitService } from '../src/common/rate-limit/rate-limit.service.js';
import { ZodPipe } from '../src/common/validation/zod.js';
import { ConfigModule } from '../src/config/config.module.js';
import { RedisModule } from '../src/infra/redis/redis.module.js';
import { integrationEnv } from './helpers.js';

const CreateThing = z.object({ name: z.string().min(1), seats: z.number().int().positive() });
let counter = 0;
let slowGate: Promise<void> = Promise.resolve();

@Public()
@Controller({ path: 'probe' })
class ProbeController {
  @Post('otp')
  @HttpCode(200)
  @RateLimit({ name: 'otp-test', limit: 3, windowSeconds: 60, by: 'body', bodyField: 'phone' })
  otp(): { sent: true } {
    return { sent: true };
  }

  @Post('things')
  @HttpCode(201)
  @Idempotent()
  create(@Body(new ZodPipe(CreateThing)) body: z.infer<typeof CreateThing>): {
    n: number;
    name: string;
  } {
    counter += 1;
    return { n: counter, name: body.name };
  }

  @Post('slow')
  @Idempotent()
  async slow(): Promise<{ done: true }> {
    await slowGate;
    return { done: true };
  }

  @Post('fails')
  @Idempotent()
  fails(@Body() body: { ok?: boolean }): { ok: true } {
    if (!body.ok) throw new AppError('FORBIDDEN', 'not yet');
    return { ok: true };
  }

  @Get('list')
  list(@Query(new ZodPipe(PaginationQuery)) q: Dto.PaginationQuery): PaginationQuery {
    return q;
  }
}

describe('cross-cutting HTTP behaviour (real Redis)', () => {
  let app: INestApplication;
  let http: Server;

  beforeAll(async () => {
    const env = integrationEnv();
    @Module({
      imports: [ConfigModule.forRoot(env), DatabaseModule, RedisModule, CommonModule],
      controllers: [ProbeController],
    })
    class ProbeModule {}
    app = await NestFactory.create(ProbeModule, { logger: false });
    app.useGlobalFilters(new AllExceptionsFilter(true));
    await app.init();
    http = app.getHttpServer() as Server;
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    counter = 0;
  });

  describe('rate limiting', () => {
    it('limits per body field (phone) across requests and returns Retry-After', async () => {
      const phone = `+9198480${Date.now() % 100000}`.padEnd(13, '0');
      for (let i = 0; i < 3; i += 1)
        await request(http).post('/probe/otp').send({ phone }).expect(200);
      const blocked = await request(http).post('/probe/otp').send({ phone }).expect(429);
      expect(blocked.body.error).toMatchObject({
        code: 'RATE_LIMITED',
        details: { rule: 'otp-test' },
      });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      await request(http).post('/probe/otp').send({ phone: '+919999999999' }).expect(200);
    });

    it('is atomic under concurrency', async () => {
      const limiter = app.get(RateLimitService);
      const key = `concurrency-${Date.now()}`;
      const results = await Promise.all(
        Array.from({ length: 50 }, () => limiter.consume(key, 10, 60_000)),
      );
      expect(results.filter((r) => r.allowed)).toHaveLength(10);
      await limiter.reset(key);
      expect((await limiter.consume(key, 10, 60_000)).remaining).toBe(9);
    });

    it('slides the window', async () => {
      const limiter = app.get(RateLimitService);
      const key = `sliding-${Date.now()}`;
      const t0 = 1_000_000;
      expect((await limiter.consume(key, 1, 1000, t0)).allowed).toBe(true);
      expect((await limiter.consume(key, 1, 1000, t0 + 500)).allowed).toBe(false);
      expect((await limiter.consume(key, 1, 1000, t0 + 1001)).allowed).toBe(true);
    });
  });

  describe('idempotency', () => {
    it('requires a well-formed Idempotency-Key', async () => {
      const missing = await request(http)
        .post('/probe/things')
        .send({ name: 'chai', seats: 4 })
        .expect(400);
      expect(missing.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      const bad = await request(http)
        .post('/probe/things')
        .set('Idempotency-Key', 'bad key!')
        .send({ name: 'chai', seats: 4 })
        .expect(400);
      expect(bad.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('replays the first response for retries with the same key and body', async () => {
      const key = `create-${Date.now()}`;
      const first = await request(http)
        .post('/probe/things')
        .set('Idempotency-Key', key)
        .send({ name: 'chai', seats: 4 })
        .expect(201);
      const second = await request(http)
        .post('/probe/things')
        .set('Idempotency-Key', key)
        .send({ name: 'chai', seats: 4 })
        .expect(201);
      expect(second.body).toEqual(first.body);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(counter).toBe(1);
    });

    it('rejects reuse of a key with a different body', async () => {
      const key = `reuse-${Date.now()}`;
      await request(http)
        .post('/probe/things')
        .set('Idempotency-Key', key)
        .send({ name: 'chai', seats: 4 })
        .expect(201);
      const res = await request(http)
        .post('/probe/things')
        .set('Idempotency-Key', key)
        .send({ name: 'biryani', seats: 4 })
        .expect(422);
      expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('returns CONFLICT while the first request is in flight', async () => {
      let release: () => void = () => undefined;
      slowGate = new Promise((r) => {
        release = r;
      });
      const key = `slow-${Date.now()}`;
      const first = request(http)
        .post('/probe/slow')
        .set('Idempotency-Key', key)
        .send({})
        .then((r) => r);
      await new Promise((r) => setTimeout(r, 100));
      const second = await request(http).post('/probe/slow').set('Idempotency-Key', key).send({});
      expect(second.status).toBe(409);
      release();
      expect((await first).status).toBe(201);
    });

    it('frees the key when the handler fails so the client can retry', async () => {
      const key = `fail-${Date.now()}`;
      await request(http).post('/probe/fails').set('Idempotency-Key', key).send({}).expect(403);
      await request(http).post('/probe/fails').set('Idempotency-Key', key).send({}).expect(403);
      await request(http)
        .post('/probe/fails')
        .set('Idempotency-Key', key)
        .send({ ok: true })
        .expect(201);
    });

    it('validates bodies with shared Zod schemas into the error envelope', async () => {
      const res = await request(http)
        .post('/probe/things')
        .set('Idempotency-Key', `v-${Date.now()}`)
        .send({ name: '', seats: -1 })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
        'name',
        'seats',
      ]);
    });
  });

  it('coerces and bounds query params', async () => {
    await request(http).get('/probe/list?limit=7').expect(200, { limit: 7 });
    const res = await request(http).get('/probe/list?limit=500').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
