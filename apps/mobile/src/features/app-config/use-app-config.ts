import { useQuery } from '@tanstack/react-query';
import { AppConfigResponse, compareVersions, isUpdateRequired } from '@touchgrass/shared';
import { useApi } from '../../providers/api-context';

export interface AppConfigState {
  config: AppConfigResponse;
  updateRequired: boolean;
  updateAvailable: boolean;
}

/** Startup config: feature flags + forced/optional update (F-PLT-01, F-PLT-02). */
export function useAppConfig() {
  const { client, appVersion } = useApi();
  return useQuery({
    queryKey: ['app-config'],
    queryFn: async ({ signal }): Promise<AppConfigState> => {
      const config = await client.request('/v1/app/config', AppConfigResponse, { signal });
      return {
        config,
        updateRequired: isUpdateRequired(appVersion, config.minSupportedVersion),
        updateAvailable: compareVersions(appVersion, config.latestVersion) < 0,
      };
    },
    staleTime: 5 * 60_000,
  });
}
