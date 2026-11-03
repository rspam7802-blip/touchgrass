import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/**
 * Normalise a phone number to E.164, defaulting to India (+91).
 * Returns null for anything that is not a valid, dialable number.
 */
export function normalizeE164(raw: string, defaultCountry: 'IN' = 'IN'): string | null {
  const trimmed = raw.replace(/[^\d+]/g, '');
  if (trimmed.length < 6) return null;
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed?.isValid()) return null;
  return parsed.number;
}

/**
 * Contact matching only ever sees SHA-256 hashes of normalised E.164 numbers (F-SOC-01).
 * The same function runs on device (before upload) and on the server (when indexing users).
 */
export function hashPhoneE164(e164: string): string {
  if (!/^\+[1-9]\d{6,14}$/.test(e164)) {
    throw new RangeError('hashPhoneE164 expects a normalised E.164 number');
  }
  return bytesToHex(sha256(utf8ToBytes(e164)));
}

export function maskPhone(e164: string): string {
  if (e164.length < 6) return '•'.repeat(e164.length);
  return `${e164.slice(0, 3)}${'•'.repeat(e164.length - 5)}${e164.slice(-2)}`;
}
