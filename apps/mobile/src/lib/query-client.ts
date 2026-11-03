import NetInfo from '@react-native-community/netinfo';
import { onlineManager, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

/** TanStack Query wired to NetInfo so queries pause offline and refetch on reconnect (F-PLT-04). */
export function createQueryClient(): QueryClient {
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(state.isConnected !== false);
    }),
  );
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 24 * 60 * 60 * 1000,
        retry: (failureCount, error) =>
          failureCount < 3 && (!(error instanceof ApiError) || error.retryable),
        networkMode: 'offlineFirst',
      },
      mutations: { networkMode: 'offlineFirst', retry: false },
    },
  });
}
