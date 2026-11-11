import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './env.js';
import { testEnv } from '../test-support/env.js';

const base = {
  DATABASE_URL: 'postgres://x',
  REDIS_URL: 'redis://x',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  TOKEN_HASH_PEPPER: 'b'.repeat(32),
  SIGNED_URL_SECRET: 'c'.repeat(32),
};

describe('env', () => {
  it('applies defaults (fake adapters, India locale ports)', () => {
    const env = testEnv();
    expect(env.SMS_PROVIDER).toBe('fake');
    expect(env.API_PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toContain('http://localhost:3000');
  });
  it('parses csv and booleans', () => {
    const env = loadEnv({
      ...base,
      CORS_ORIGINS: 'https://a.app, https://b.app,',
      S3_FORCE_PATH_STYLE: 'true',
    });
    expect(env.CORS_ORIGINS).toEqual(['https://a.app', 'https://b.app']);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });
  it('requires provider keys when real providers are selected', () => {
    expect(() => loadEnv({ ...base, SMS_PROVIDER: 'msg91' })).toThrow(/MSG91_AUTH_KEY/);
    expect(() => loadEnv({ ...base, PAYMENTS_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'k' })).toThrow(
      /RAZORPAY_KEY_SECRET/,
    );
  });
  it('test sign-ins: valid pairs only, never 000000, never in production (staging)', () => {
    expect(loadEnv({ ...base }).OTP_DEV_BYPASS).toBe(true);
    expect(loadEnv({ ...base, OTP_DEV_BYPASS: 'false' }).OTP_DEV_BYPASS).toBe(false);
    expect(
      loadEnv({ ...base, TEST_LOGINS: '+919876543210:482913,+919812345678:730164' }).TEST_LOGINS,
    ).toBe('+919876543210:482913,+919812345678:730164');
    expect(() => loadEnv({ ...base, TEST_LOGINS: '9876543210:482913' })).toThrow(/TEST_LOGINS/);
    expect(() => loadEnv({ ...base, TEST_LOGINS: '+919876543210:000000' })).toThrow(/000000/);
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'production', TEST_LOGINS: '+919876543210:482913' }),
    ).toThrow(/TEST_LOGINS is not allowed in production/);
  });

  it('refuses fake adapters in production', () => {
    try {
      loadEnv({ ...base, NODE_ENV: 'production' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as EnvValidationError).issues.join('\n')).toMatch(
        /SMS_PROVIDER=fake is not allowed in production/,
      );
      expect(loadEnv({ ...base, EMAIL_PROVIDER: 'fake' }).EMAIL_PROVIDER).toBe('fake');
    }
  });
  it('accepts the lean go-live settings file in production (D-165, D-166)', () => {
    // infra/railway/production-variables.env with its <placeholders> filled in plausibly.
    const file = readFileSync(
      new URL('../../../../infra/railway/production-variables.env', import.meta.url),
      'utf8',
    );
    const filled: Record<string, string> = {};
    for (const line of file.split('\n')) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      if (!m?.[1]) continue;
      filled[m[1]] = (m[2] ?? '')
        .replace(/\$\{\{Redis\.REDIS_URL\}\}/, 'redis://redis.railway.internal:6379')
        .replace(/^<postgres.*>$/, 'postgres://u:p@pooler.supabase.com:5432/postgres')
        .replace(
          /^<-----BEGIN.*>$/,
          '-----BEGIN CERTIFICATE-----\\nAAAA\\n-----END CERTIFICATE-----',
        )
        .replace(/^<secret \d>$/, 'x'.repeat(64))
        .replace(/^<\+91.*>$/, '+919000012345')
        .replace(/^<6 digits.*>$/, '482913')
        .replace(/^<smtp:.*>$/, 'smtp://u:p@smtp-relay.brevo.com:587')
        .replace(/https:\/\/<[^>]+>/g, 'https://example.up.railway.app')
        .replace(/<[^>]+>/g, 'value');
    }
    const env = loadEnv(filled);
    expect(env).toMatchObject({
      NODE_ENV: 'production',
      SMS_PROVIDER: 'none',
      PHONE_AUTH_PROVIDER: 'firebase',
      PAYMENTS_PROVIDER: 'disabled',
      WEATHER_PROVIDER: 'none',
      MODERATION_PROVIDER: 'google-vision',
    });
  });
  it('keeps sign-in possible and fakes out of production', () => {
    expect(() => loadEnv({ ...base, SMS_PROVIDER: 'none' })).toThrow(/needs PHONE_AUTH_PROVIDER/);
    expect(() => loadEnv({ ...base, PHONE_AUTH_PROVIDER: 'firebase' })).toThrow(
      /FIREBASE_PROJECT_ID/,
    );
    expect(() => loadEnv({ ...base, MODERATION_PROVIDER: 'google-vision' })).toThrow(
      /GOOGLE_VISION_API_KEY/,
    );
    expect(() => loadEnv({ ...base, NODE_ENV: 'production', PHONE_AUTH_PROVIDER: 'fake' })).toThrow(
      /PHONE_AUTH_PROVIDER=fake is not allowed in production/,
    );
  });
  it('rejects short secrets', () => {
    expect(() => loadEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(EnvValidationError);
  });
  it('treats empty values as unset', () => {
    const env = loadEnv({ ...base, STORE_REVIEW_PHONE: '', STORE_REVIEW_OTP: '', API_PORT: '' });
    expect(env.STORE_REVIEW_PHONE).toBeUndefined();
    expect(env.API_PORT).toBe(4000);
  });
  it('validates the store review sign-in pair', () => {
    const env = loadEnv({
      ...base,
      STORE_REVIEW_PHONE: '+919000012345',
      STORE_REVIEW_OTP: '482913',
    });
    expect(env.STORE_REVIEW_PHONE).toBe('+919000012345');
    expect(() => loadEnv({ ...base, STORE_REVIEW_PHONE: '+919000012345' })).toThrow(
      /STORE_REVIEW_OTP is required/,
    );
    expect(() => loadEnv({ ...base, STORE_REVIEW_OTP: '482913' })).toThrow(
      /STORE_REVIEW_PHONE is required/,
    );
    expect(() =>
      loadEnv({ ...base, STORE_REVIEW_PHONE: '9000012345', STORE_REVIEW_OTP: '482913' }),
    ).toThrow(/E\.164/);
    expect(() =>
      loadEnv({ ...base, STORE_REVIEW_PHONE: '+919000012345', STORE_REVIEW_OTP: '000000' }),
    ).toThrow(/development code/);
  });
});
