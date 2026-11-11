import { createHash } from 'node:crypto';
import { invalidPhoneProof, PhoneIdentityVerifier, type VerifiedPhone } from './phone-auth.port.js';

/**
 * Development and tests (`PHONE_AUTH_PROVIDER=fake`, refused in production): a proof is the text
 * `fake-phone:<E.164>:<anything unique>`, valid for an hour.
 */
export class FakePhoneVerifier extends PhoneIdentityVerifier {
  verify(token: string, now: Date = new Date()): Promise<VerifiedPhone> {
    const match = /^fake-phone:(\+[1-9]\d{6,14}):.+$/.exec(token);
    if (!match?.[1]) return Promise.reject(invalidPhoneProof('MALFORMED'));
    return Promise.resolve({
      phoneE164: match[1],
      proofId: createHash('sha256').update(token).digest('hex'),
      authTime: now,
      expiresAt: new Date(now.getTime() + 3_600_000),
    });
  }
}
