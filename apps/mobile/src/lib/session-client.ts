import { AuthTokens } from '@touchgrass/shared';
import { useAuthStore } from '../stores/auth-store';
import { ApiClient, ApiError } from './api-client';

/**
 * The app's API client: attaches the access token and refreshes it once on expiry (single-flight, so a burst of
 * expired requests triggers one refresh). A failed refresh signs the user out.
 */
export function createSessionClient(
  baseUrl: string,
  appVersion: string,
  fetchFn?: typeof fetch,
): ApiClient {
  let inflight: Promise<string | null> | null = null;
  const refreshClient = new ApiClient({ baseUrl, appVersion, fetchFn });

  const refresh = (): Promise<string | null> => {
    inflight ??= (async () => {
      const session = useAuthStore.getState().session;
      if (!session) return null;
      try {
        const tokens = await refreshClient.request('/v1/auth/refresh', AuthTokens, {
          method: 'POST',
          body: { refreshToken: session.tokens.refreshToken },
        });
        await useAuthStore.getState().setTokens(tokens);
        return tokens.accessToken;
      } catch (err) {
        if (err instanceof ApiError && !err.retryable) await useAuthStore.getState().signOut();
        return null;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  };

  return new ApiClient({
    baseUrl,
    appVersion,
    fetchFn,
    getAccessToken: () => useAuthStore.getState().session?.tokens.accessToken ?? null,
    refreshAccessToken: refresh,
  });
}
