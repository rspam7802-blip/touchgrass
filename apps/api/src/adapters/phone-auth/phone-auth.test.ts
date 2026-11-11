import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FakePhoneVerifier } from './fake.phone-auth.js';
import { FirebasePhoneVerifier } from './firebase.phone-auth.js';
import { NoPhoneIdentityVerifier } from './phone-auth.port.js';

const PROJECT = 'touchgrass-test';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const now = new Date('2026-11-12T10:00:00Z');
const t = Math.floor(now.getTime() / 1000);

const b64 = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');
function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  key = privateKey,
): string {
  const h = b64({ alg: 'RS256', kid: 'k1', typ: 'JWT', ...header });
  const p = b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'firebase-uid-1',
    iat: t - 30,
    exp: t + 3600,
    auth_time: t - 30,
    phone_number: '+919876543210',
    firebase: { sign_in_provider: 'phone' },
    ...claims,
  });
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), key).toString('base64url')}`;
}

function keysFetch(): { fetch: typeof fetch; calls: number } {
  const state = { calls: 0 };
  const fn = (): Promise<Response> => {
    state.calls += 1;
    return Promise.resolve(
      new Response(JSON.stringify({ keys: [jwk] }), {
        headers: { 'cache-control': 'public, max-age=20000' },
      }),
    );
  };
  return {
    fetch: fn,
    get calls() {
      return state.calls;
    },
  };
}

describe('Firebase phone proofs (D-166)', () => {
  it('accepts a phone sign-in signed by Google for our project, and caches the keys', async () => {
    const f = keysFetch();
    const v = new FirebasePhoneVerifier(PROJECT, f.fetch);
    const proof = await v.verify(token(), now);
    expect(proof).toMatchObject({
      phoneE164: '+919876543210',
      authTime: new Date((t - 30) * 1000),
      expiresAt: new Date((t + 3600) * 1000),
    });
    expect(proof.proofId).toMatch(/^[0-9a-f]{64}$/);
    await v.verify(token(), now);
    expect(f.calls).toBe(1);
  });

  it.each([
    ['another project', { aud: 'someone-else' }, {}, 'AUDIENCE'],
    ['another issuer', { iss: 'https://evil.example' }, {}, 'ISSUER'],
    ['expired', { exp: t - 120 }, {}, 'EXPIRED'],
    ['issued in the future', { iat: t + 600 }, {}, 'ISSUED_AT'],
    ['not a phone sign-in', { firebase: { sign_in_provider: 'password' } }, {}, 'NOT_PHONE'],
    ['no phone number', { phone_number: undefined }, {}, 'NOT_PHONE'],
    ['no subject', { sub: '' }, {}, 'SUBJECT'],
    ['an unknown key', {}, { kid: 'nope' }, 'UNKNOWN_KEY'],
    ['another algorithm', {}, { alg: 'HS256' }, 'ALGORITHM'],
  ])('refuses a token for %s', async (_case, claims, header, reason) => {
    const v = new FirebasePhoneVerifier(PROJECT, keysFetch().fetch);
    await expect(v.verify(token(claims, header), now)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      details: { reason },
    });
  });

  it('refuses a forged signature and malformed tokens', async () => {
    const v = new FirebasePhoneVerifier(PROJECT, keysFetch().fetch);
    await expect(v.verify(token({}, {}, other.privateKey), now)).rejects.toMatchObject({
      details: { reason: 'SIGNATURE' },
    });
    await expect(v.verify('not-a-jwt', now)).rejects.toMatchObject({
      details: { reason: 'MALFORMED' },
    });
    await expect(v.verify('a.b.c', now)).rejects.toMatchObject({
      details: { reason: 'MALFORMED' },
    });
  });

  it('fake proofs are for development only; none disables the route', async () => {
    const fake = new FakePhoneVerifier();
    expect((await fake.verify('fake-phone:+919876543210:n1', now)).phoneE164).toBe('+919876543210');
    await expect(fake.verify('fake-phone:12345:n1', now)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(new NoPhoneIdentityVerifier().verify('x')).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
    });
  });
});
