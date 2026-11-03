import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashPhoneE164, maskPhone, normalizeE164 } from './phone';

describe('phone', () => {
  it('normalises Indian numbers in common formats to E.164', () => {
    expect(normalizeE164('98480 22338')).toBe('+919848022338');
    expect(normalizeE164('+91-98480-22338')).toBe('+919848022338');
    expect(normalizeE164('09848022338')).toBe('+919848022338');
    expect(normalizeE164('+14155552671')).toBe('+14155552671');
  });
  it('rejects invalid numbers', () => {
    expect(normalizeE164('12345')).toBeNull();
    expect(normalizeE164('not a number')).toBeNull();
    expect(normalizeE164('+91 11111')).toBeNull();
  });
  it('hashes E.164 numbers with SHA-256 matching node:crypto', () => {
    const e164 = '+919848022338';
    expect(hashPhoneE164(e164)).toBe(createHash('sha256').update(e164).digest('hex'));
    expect(() => hashPhoneE164('9848022338')).toThrow(RangeError);
  });
  it('masks numbers for display', () => {
    expect(maskPhone('+919848022338')).toBe('+91••••••••38');
    expect(maskPhone('+91')).toBe('•••');
  });
});
