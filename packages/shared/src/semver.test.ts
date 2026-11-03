import { describe, expect, it } from 'vitest';
import { compareVersions, isUpdateRequired } from './semver';

describe('semver', () => {
  it('compares versions numerically', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
    expect(compareVersions('2.0.0-beta.1', '2.0.0')).toBe(0);
  });
  it('detects forced updates', () => {
    expect(isUpdateRequired('1.0.0', '1.1.0')).toBe(true);
    expect(isUpdateRequired('1.1.0', '1.1.0')).toBe(false);
  });
  it('rejects garbage', () => {
    expect(() => compareVersions('one', '1.0.0')).toThrow(RangeError);
  });
});
