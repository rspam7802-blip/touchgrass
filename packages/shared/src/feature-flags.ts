/** Known feature flags and their safe defaults (F-PLT-01). Stored in the DB; these defaults apply when a row is missing. */
export const FEATURE_FLAG_DEFAULTS = {
  invite_gate: true,
  /** Hosting needs a verified profile (F-HST-01, F-SAF-01). Ops can relax it while verification capacity ramps up. */
  require_verification_to_host: true,
  /** New members send a verification selfie during profile setup (D-181). Ops can switch it off if reviews back up. */
  require_verification_to_join: true,
  paid_events: true,
  live_location: true,
  free_now: true,
  recaps: true,
  challenges: true,
  referrals: true,
  map_view: true,
  /** Squad stories (Phase 13). */
  stories: true,
} as const satisfies Record<string, boolean>;

export type FeatureFlagKey = keyof typeof FEATURE_FLAG_DEFAULTS;

export function isFeatureFlagKey(key: string): key is FeatureFlagKey {
  return Object.prototype.hasOwnProperty.call(FEATURE_FLAG_DEFAULTS, key);
}
