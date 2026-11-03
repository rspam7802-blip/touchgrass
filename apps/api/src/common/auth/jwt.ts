import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Minimal HS256 JWT for short-lived access tokens (15 min). Refresh tokens are opaque random strings
 * stored hashed in the database (Phase 1), so no third-party JWT library is needed.
 */
export const AccessTokenClaims = z.object({
  sub: z.uuid(),
  sid: z.uuid(),
  roles: z.array(z.string()).default([]),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type AccessTokenClaims = z.infer<typeof AccessTokenClaims>;

export type JwtVerifyError = 'malformed' | 'bad_signature' | 'expired' | 'invalid_claims';
export type JwtVerifyResult =
  { ok: true; claims: AccessTokenClaims } | { ok: false; error: JwtVerifyError };

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');
const HEADER = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export function signAccessToken(
  claims: { sub: string; sid: string; roles?: string[] },
  secret: string,
  ttlSeconds: number,
  now: Date = new Date(),
): string {
  const iat = Math.floor(now.getTime() / 1000);
  const payload = b64url(
    JSON.stringify({
      sub: claims.sub,
      sid: claims.sid,
      roles: claims.roles ?? [],
      iat,
      exp: iat + ttlSeconds,
    }),
  );
  const data = `${HEADER}.${payload}`;
  return `${data}.${sign(data, secret)}`;
}

export function verifyAccessToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): JwtVerifyResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, error: 'malformed' };
  const [header, payload, signature] = parts as [string, string, string];
  if (header !== HEADER) return { ok: false, error: 'malformed' };
  const expected = Buffer.from(sign(`${header}.${payload}`, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual))
    return { ok: false, error: 'bad_signature' };
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'malformed' };
  }
  const parsed = AccessTokenClaims.safeParse(decoded);
  if (!parsed.success) return { ok: false, error: 'invalid_claims' };
  if (parsed.data.exp <= Math.floor(now.getTime() / 1000)) return { ok: false, error: 'expired' };
  return { ok: true, claims: parsed.data };
}
