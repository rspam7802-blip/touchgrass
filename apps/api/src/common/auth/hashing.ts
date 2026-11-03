import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Keyed hash for secrets at rest (OTP codes, refresh tokens). The pepper lives in Secrets Manager, not the DB. */
export function pepperedHash(pepper: string, value: string): string {
  return createHmac('sha256', pepper).update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function randomNumericCode(length: number): string {
  return Array.from({ length }, () => randomInt(0, 10)).join('');
}

/** Unambiguous alphabet for human-typed codes (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function randomInviteCode(length: number): string {
  return Array.from({ length }, () =>
    CODE_ALPHABET.charAt(randomInt(0, CODE_ALPHABET.length)),
  ).join('');
}
