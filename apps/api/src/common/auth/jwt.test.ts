import { describe, expect, it } from 'vitest';
import { signAccessToken, verifyAccessToken } from './jwt.js';

const secret = 's'.repeat(40);
const claims = {
  sub: '0192f3a4-5b6c-7d8e-9f01-23456789abcd',
  sid: '0192f3a4-5b6c-7d8e-9f01-23456789abce',
  roles: ['admin'],
};

describe('jwt', () => {
  it('signs and verifies', () => {
    const now = new Date('2026-10-31T10:00:00Z');
    const token = signAccessToken(claims, secret, 900, now);
    const result = verifyAccessToken(token, secret, now);
    expect(result).toEqual({
      ok: true,
      claims: expect.objectContaining({ sub: claims.sub, roles: ['admin'] }),
    });
  });
  it('rejects expired tokens', () => {
    const token = signAccessToken(claims, secret, 900, new Date('2026-10-31T10:00:00Z'));
    expect(verifyAccessToken(token, secret, new Date('2026-10-31T10:15:00Z'))).toEqual({
      ok: false,
      error: 'expired',
    });
  });
  it('rejects tampering and wrong secrets', () => {
    const token = signAccessToken(claims, secret, 900);
    const [h, p, s] = token.split('.') as [string, string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...claims, roles: ['super_admin'], iat: 1, exp: 9_999_999_999 }),
    ).toString('base64url');
    expect(verifyAccessToken(`${h}.${forged}.${s}`, secret)).toEqual({
      ok: false,
      error: 'bad_signature',
    });
    expect(verifyAccessToken(token, 'x'.repeat(40))).toEqual({ ok: false, error: 'bad_signature' });
    expect(verifyAccessToken(`${h}.${p}`, secret)).toEqual({ ok: false, error: 'malformed' });
    expect(verifyAccessToken(`xx.${p}.${s}`, secret)).toEqual({ ok: false, error: 'malformed' });
  });
  it('rejects valid signatures over bad claims', () => {
    const token = signAccessToken({ sub: 'not-a-uuid', sid: claims.sid }, secret, 900);
    expect(verifyAccessToken(token, secret)).toEqual({ ok: false, error: 'invalid_claims' });
  });
});
