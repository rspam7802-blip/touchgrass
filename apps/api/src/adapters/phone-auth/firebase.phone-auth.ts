import {
  createHash,
  createPublicKey,
  type JsonWebKey,
  verify as verifySignature,
} from 'node:crypto';
import type { FetchFn } from '../http/http-client.js';
import { invalidPhoneProof, PhoneIdentityVerifier, type VerifiedPhone } from './phone-auth.port.js';

/** Google's public keys for Firebase Authentication ID tokens, as a JWK set. */
const JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
/** Clock skew we tolerate between Google and us. */
const SKEW_S = 60;

interface Jwk extends JsonWebKey {
  kid?: string;
}
interface Header {
  alg?: string;
  kid?: string;
}
interface Claims {
  iss?: string;
  aud?: string;
  sub?: string;
  iat?: number;
  exp?: number;
  auth_time?: number;
  phone_number?: string;
  firebase?: { sign_in_provider?: string };
}

const b64urlJson = (part: string): unknown =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

/**
 * Verifies Firebase Authentication ID tokens (D-166) the way Google documents for third-party JWT
 * libraries: RS256 signed by a current Google key, issued by and for our project, unexpired, for a phone
 * sign-in. Keys are cached for as long as Google's Cache-Control allows.
 */
export class FirebasePhoneVerifier extends PhoneIdentityVerifier {
  private keys: { byKid: Map<string, Jwk>; until: number } | null = null;

  constructor(
    private readonly projectId: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {
    super();
  }

  async verify(token: string, now: Date = new Date()): Promise<VerifiedPhone> {
    const parts = token.split('.');
    if (parts.length !== 3) throw invalidPhoneProof('MALFORMED');
    const [h, p, s] = parts as [string, string, string];
    let header: Header;
    let claims: Claims;
    try {
      header = b64urlJson(h) as Header;
      claims = b64urlJson(p) as Claims;
    } catch {
      throw invalidPhoneProof('MALFORMED');
    }
    if (header.alg !== 'RS256' || !header.kid) throw invalidPhoneProof('ALGORITHM');
    const jwk = await this.key(header.kid, now);
    if (!jwk) throw invalidPhoneProof('UNKNOWN_KEY');
    const ok = verifySignature(
      'RSA-SHA256',
      Buffer.from(`${h}.${p}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(s, 'base64url'),
    );
    if (!ok) throw invalidPhoneProof('SIGNATURE');

    const t = Math.floor(now.getTime() / 1000);
    if (claims.aud !== this.projectId) throw invalidPhoneProof('AUDIENCE');
    if (claims.iss !== `https://securetoken.google.com/${this.projectId}`)
      throw invalidPhoneProof('ISSUER');
    if (!claims.sub) throw invalidPhoneProof('SUBJECT');
    if (typeof claims.exp !== 'number' || claims.exp + SKEW_S <= t)
      throw invalidPhoneProof('EXPIRED');
    if (typeof claims.iat !== 'number' || claims.iat - SKEW_S > t)
      throw invalidPhoneProof('ISSUED_AT');
    if (typeof claims.auth_time !== 'number' || claims.auth_time - SKEW_S > t)
      throw invalidPhoneProof('AUTH_TIME');
    if (claims.firebase?.sign_in_provider !== 'phone' || !claims.phone_number)
      throw invalidPhoneProof('NOT_PHONE');
    return {
      phoneE164: claims.phone_number,
      proofId: createHash('sha256').update(s).digest('hex'),
      authTime: new Date(claims.auth_time * 1000),
      expiresAt: new Date(claims.exp * 1000),
    };
  }

  private async key(kid: string, now: Date): Promise<Jwk | undefined> {
    if (!this.keys || this.keys.until <= now.getTime() || !this.keys.byKid.has(kid)) {
      const res = await this.fetchFn(JWKS_URL, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`Firebase keys request failed with ${String(res.status)}`);
      const body = (await res.json()) as { keys?: Jwk[] };
      const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
      this.keys = {
        byKid: new Map((body.keys ?? []).flatMap((k) => (k.kid ? [[k.kid, k] as const] : []))),
        until: now.getTime() + Math.min(Number(maxAge ?? 3600), 6 * 3600) * 1000,
      };
    }
    return this.keys.byKid.get(kid);
  }
}
