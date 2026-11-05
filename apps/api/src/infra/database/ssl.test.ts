import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.js';
import { sslFor } from './database.module.js';

const PEM = '-----BEGIN CERTIFICATE-----\\nMIIBfake\\n-----END CERTIFICATE-----';

describe('database TLS for hosted Postgres (Supabase)', () => {
  it('leaves TLS to the connection string when no CA is given', () => {
    expect(sslFor(undefined)).toBeUndefined();
  });

  it('verifies the server against the given CA, turning escaped newlines back into real ones', () => {
    expect(sslFor(PEM)).toEqual({
      ca: '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----',
      rejectUnauthorized: true,
    });
  });

  it('only accepts a PEM certificate', () => {
    const base = {
      DATABASE_URL: 'postgres://x',
      REDIS_URL: 'redis://x',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      TOKEN_HASH_PEPPER: 'b'.repeat(32),
      SIGNED_URL_SECRET: 'c'.repeat(32),
    };
    expect(loadEnv({ ...base, DATABASE_CA_CERT: PEM }).DATABASE_CA_CERT).toBe(PEM);
    expect(() => loadEnv({ ...base, DATABASE_CA_CERT: 'not a cert' })).toThrow(/DATABASE_CA_CERT/);
  });
});
