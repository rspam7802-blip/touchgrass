import type { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiApp } from '../src/bootstrap.js';
import { FeatureFlagsService } from '../src/modules/platform/feature-flags.service.js';
import { probe } from '../src/modules/health/health.controller.js';
import { integrationEnv } from './helpers.js';

describe('API app (real Postgres + Redis)', () => {
  let app: INestApplication;
  let http: Server;

  beforeAll(async () => {
    app = await createApiApp(integrationEnv({ STORAGE_PROVIDER: 'memory' }), { logger: false });
    await app.init();
    http = app.getHttpServer() as Server;
  });
  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health reports db and redis up', async () => {
    const res = await request(http).get('/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', version: '0.1.0', checks: { db: 'up', redis: 'up' } });
    await request(http).get('/v1/health/live').expect(200, { status: 'ok' });
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(http).get('/v1/health/live');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['ratelimit-limit']).toBeDefined();
  });

  it('allows configured CORS origins only', async () => {
    const ok = await request(http)
      .options('/v1/health')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'GET');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const bad = await request(http)
      .options('/v1/health')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'GET');
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns the standard error envelope for unknown routes and malformed JSON', async () => {
    const res = await request(http).get('/v1/does-not-exist').expect(404);
    expect(res.body).toEqual({
      error: { code: 'NOT_FOUND', message: expect.any(String) as string },
    });
    const bad = await request(http)
      .post('/v1/health')
      .set('content-type', 'application/json')
      .send('{"broken"');
    expect(bad.body.error.code).toMatch(/VALIDATION_FAILED|NOT_FOUND/);
  });

  it('rejects oversized JSON bodies', async () => {
    const res = await request(http)
      .post('/v1/app/config')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ x: 'a'.repeat(300_000) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('GET /v1/app/config returns flags and versions; flag writes invalidate the cache', async () => {
    const before = await request(http).get('/v1/app/config').expect(200);
    expect(before.body).toMatchObject({
      minSupportedVersion: '0.1.0',
      latestVersion: '0.1.0',
      flags: { invite_gate: true },
    });
    const flags = app.get(FeatureFlagsService);
    await flags.set('invite_gate', false, 'Open signup');
    const after = await request(http).get('/v1/app/config').expect(200);
    expect(after.body.flags.invite_gate).toBe(false);
    expect(await flags.isEnabled('invite_gate')).toBe(false);
    await flags.set('invite_gate', true);
    expect(await flags.isEnabled('invite_gate')).toBe(true);
  });

  it('publishes OpenAPI docs outside production', async () => {
    const res = await request(http).get('/docs/openapi.json').expect(200);
    expect(res.body.paths['/v1/health']).toBeDefined();
    expect(res.body.paths['/v1/app/config']).toBeDefined();
    expect(res.body.paths['/v1/auth/otp/verify']).toBeDefined();
    expect(res.body.paths['/v1/me/profile']).toBeDefined();
  });

  it('health probes time out instead of hanging', async () => {
    expect(await probe(new Promise(() => undefined), 20)).toBe('down');
    expect(await probe(Promise.reject(new Error('x')))).toBe('down');
  });
});

describe('API app in production mode', () => {
  it('does not expose /docs', async () => {
    const app = await createApiApp(
      integrationEnv({
        NODE_ENV: 'production',
        SMS_PROVIDER: 'msg91',
        MSG91_AUTH_KEY: 'k',
        MSG91_OTP_TEMPLATE_ID: 't',
        PAYMENTS_PROVIDER: 'razorpay',
        RAZORPAY_KEY_ID: 'k',
        RAZORPAY_KEY_SECRET: 's',
        RAZORPAY_WEBHOOK_SECRET: 'w',
        PUSH_PROVIDER: 'expo',
        STORAGE_PROVIDER: 's3',
        MAPS_PROVIDER: 'google',
        GOOGLE_MAPS_API_KEY: 'g',
        WEATHER_PROVIDER: 'openweather',
        OPENWEATHER_API_KEY: 'o',
        MODERATION_PROVIDER: 'rekognition',
      }),
      { logger: false },
    );
    await app.init();
    await request(app.getHttpServer() as Server)
      .get('/docs/openapi.json')
      .expect(404);
    await app.close();
  });
});
