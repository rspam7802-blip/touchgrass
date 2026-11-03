import { FEATURE_FLAG_DEFAULTS, type FeatureFlagKey } from '@touchgrass/shared';
import { useAppConfig } from './use-app-config';

/** A feature flag from startup config (F-PLT-01); the safe default applies until config has loaded. */
export function useFlag(key: FeatureFlagKey): boolean {
  const config = useAppConfig();
  return config.data?.config.flags[key] ?? FEATURE_FLAG_DEFAULTS[key];
}
