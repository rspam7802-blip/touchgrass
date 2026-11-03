import { useFonts } from 'expo-font';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef } from 'react';
import { readAppEnvironment } from '../src/config';
import { createQueryClient } from '../src/lib/query-client';
import { clearOfflineCache, persistOfflineCache } from '../src/lib/query-persist';
import { createSessionClient } from '../src/lib/session-client';
import { AppProviders } from '../src/providers/app-providers';
import { type AppArea, appArea, useAuthStore } from '../src/stores/auth-store';
import { useSettingsStore } from '../src/stores/settings-store';
import { FONT_FILES } from '../src/theme/fonts';

void SplashScreen.preventAutoHideAsync();

/** Where each area starts. Stack.Protected removes the other areas' screens from the navigator entirely. */
export function landingRoute(
  area: AppArea,
  tutorialComplete: boolean,
): '/' | '/start' | '/tutorial' | '/discover' | null {
  switch (area) {
    case 'loading':
      return null;
    case 'public':
      return '/';
    case 'onboarding':
      return '/start';
    case 'app':
      return tutorialComplete ? '/discover' : '/tutorial';
  }
}

function RootNavigator() {
  const router = useRouter();
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.session?.user);
  const area = appArea(status, user);
  const previous = useRef<AppArea>('loading');

  useEffect(() => {
    void useAuthStore.getState().hydrate();
  }, []);

  useEffect(() => {
    if (area === previous.current) return;
    previous.current = area;
    const target = landingRoute(area, user?.tutorialComplete ?? false);
    if (target) router.replace(target);
  }, [area, router, user?.tutorialComplete]);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={area === 'public' || area === 'loading'}>
        <Stack.Screen name="index" />
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Protected guard={area === 'onboarding'}>
        <Stack.Screen name="(onboarding)" />
      </Stack.Protected>
      <Stack.Protected guard={area === 'app'}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      {/* Deep links work in every area; each screen decides what a signed-out visitor sees. */}
      <Stack.Screen name="e/[slug]" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="claim/[token]" options={{ headerShown: true, title: '' }} />
      <Stack.Screen name="u/[id]" />
      <Stack.Screen name="c/[id]" />
    </Stack>
  );
}

export default function RootLayout() {
  const env = useMemo(() => readAppEnvironment(), []);
  const queryClient = useMemo(() => createQueryClient(), []);
  const apiClient = useMemo(() => createSessionClient(env.apiUrl, env.appVersion), [env]);
  const settingsHydrated = useSettingsStore((s) => s.hydrated);
  const authStatus = useAuthStore((s) => s.status);
  // A font that fails to load falls back to the system font rather than blocking the app.
  const [fontsLoaded, fontError] = useFonts(FONT_FILES);
  const fontsReady = fontsLoaded || fontError !== null;

  useEffect(() => {
    if (settingsHydrated && authStatus !== 'loading' && fontsReady) void SplashScreen.hideAsync();
  }, [settingsHydrated, authStatus, fontsReady]);

  // Offline cache (F-PLT-04): restored at launch, dropped on sign-out so nobody sees another person's data.
  useEffect(() => persistOfflineCache(queryClient), [queryClient]);
  useEffect(() => {
    if (authStatus !== 'signedOut') return;
    queryClient.clear();
    void clearOfflineCache();
  }, [authStatus, queryClient]);

  return (
    <AppProviders queryClient={queryClient} apiClient={apiClient} appVersion={env.appVersion}>
      <StatusBar style="light" />
      {fontsReady ? <RootNavigator /> : null}
    </AppProviders>
  );
}
