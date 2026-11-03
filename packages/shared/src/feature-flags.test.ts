import { describe, expect, it } from 'vitest';
import { FEATURE_FLAG_DEFAULTS, isFeatureFlagKey } from './feature-flags';

describe('feature flags', () => {
  it('recognises known keys only', () => {
    expect(isFeatureFlagKey('invite_gate')).toBe(true);
    expect(isFeatureFlagKey('toString')).toBe(false);
    expect(FEATURE_FLAG_DEFAULTS.invite_gate).toBe(true);
  });
});
