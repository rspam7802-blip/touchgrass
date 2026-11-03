import { describe, expect, it } from 'vitest';
import {
  assertPaise,
  formatPaise,
  localeTag,
  paiseToRupees,
  percentOfPaise,
  rupeesToPaise,
} from './money';

describe('money', () => {
  it('converts rupees to paise without float drift', () => {
    expect(rupeesToPaise(19.99)).toBe(1999);
    expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    expect(paiseToRupees(25050)).toBe(250.5);
  });
  it('rejects negative, fractional and unsafe amounts', () => {
    expect(() => assertPaise(-1)).toThrow(RangeError);
    expect(() => assertPaise(1.5)).toThrow(RangeError);
    expect(() => assertPaise(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
  it('computes basis-point percentages rounded to whole paise', () => {
    expect(percentOfPaise(49900, 1000)).toBe(4990);
    expect(percentOfPaise(333, 1800)).toBe(60);
    expect(() => percentOfPaise(100, -5)).toThrow(RangeError);
    expect(() => percentOfPaise(100, 1.5)).toThrow(RangeError);
  });
  it('formats INR per locale', () => {
    expect(formatPaise(49900, 'en')).toBe('₹499');
    expect(formatPaise(12345678, 'en')).toBe('₹1,23,456.78');
    expect(formatPaise(49900, 'hi')).toContain('499');
    expect(formatPaise(49900)).toBe('₹499');
    expect(localeTag('te')).toBe('te-IN');
  });
});
