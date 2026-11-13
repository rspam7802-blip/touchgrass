import { describe, expect, it } from 'vitest';
import { ageOn } from './customers.service.js';

describe('Customer 360 age (D-192)', () => {
  it('counts whole years in India’s calendar', () => {
    // 18:45 UTC on 9 March is already 10 March in India.
    const now = new Date('2026-03-09T18:45:00Z');
    expect(ageOn('2000-03-10', now)).toBe(26);
    expect(ageOn('2000-03-11', now)).toBe(25);
    expect(ageOn('1999-12-31', now)).toBe(26);
  });

  it('is empty without a usable birth date', () => {
    expect(ageOn(null, new Date())).toBeNull();
    expect(ageOn('not-a-date', new Date())).toBeNull();
  });
});
