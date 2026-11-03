import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import type { Query, QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

/** What is worth showing offline (F-PLT-04): your profile, plans, the feed, chats and the inbox. */
const OFFLINE_ROOTS = new Set([
  'me',
  'events',
  'discover',
  'chat',
  'notifications',
  'crews',
  'proposals',
  'app-config',
  'interests',
  'vibe-tags',
]);
/** Search results and map tiles change with every keystroke and pan; they're not worth the space. */
const SKIP_SECOND = new Set(['search', 'map']);

export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Bumped whenever cached shapes change, so an old cache is dropped instead of misread. */
export const PERSIST_BUSTER = 'p10-1';

export function shouldPersist(query: Pick<Query, 'queryKey' | 'state'>): boolean {
  if (query.state.status !== 'success') return false;
  const [root, second] = query.queryKey;
  return (
    typeof root === 'string' &&
    OFFLINE_ROOTS.has(root) &&
    !(typeof second === 'string' && SKIP_SECOND.has(second))
  );
}

/** Persists the allow-listed queries to AsyncStorage and restores them at launch. Returns the unsubscribe. */
export function persistOfflineCache(queryClient: QueryClient): () => void {
  const persister = createAsyncStoragePersister({
    storage: AsyncStorage,
    key: 'touchgrass-query-cache',
    throttleTime: 2_000,
  });
  const [unsubscribe] = persistQueryClient({
    queryClient,
    persister,
    maxAge: PERSIST_MAX_AGE_MS,
    buster: PERSIST_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersist },
  });
  return unsubscribe;
}

/** Sign-out and account switches must not leave someone else's cache on the phone. */
export async function clearOfflineCache(): Promise<void> {
  await AsyncStorage.removeItem('touchgrass-query-cache');
}
