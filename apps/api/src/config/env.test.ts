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
  it('refuses fake adapters in production', () => {
    try {
      loadEnv({ ...base, NODE_ENV: 'production' });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as EnvValidationError).issues.join('\n')).toMatch(
        /SMS_PROVIDER=fake is not allowed in production/,
      );
    }
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
