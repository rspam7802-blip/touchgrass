import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { SupportedLanguage } from '@touchgrass/shared';
import { type ReactNode, useEffect, useMemo } from 'react';
import { I18nextProvider } from 'react-i18next';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createI18n, detectDeviceLanguage } from '../i18n/i18n';
import type { ApiClient } from '../lib/api-client';
import { useSettingsStore } from '../stores/settings-store';
import { ThemeProvider } from '../theme/theme';
import { ApiProvider } from './api-context';

export interface AppProvidersProps {
  children: ReactNode;
  queryClient: QueryClient;
  apiClient: ApiClient;
  appVersion: string;
  forcedScheme?: 'light' | 'dark';
  initialLanguage?: SupportedLanguage;
}

/** Every provider the app needs, in one place, so screens and tests render identically. */
export function AppProviders({
  children,
  queryClient,
  apiClient,
  appVersion,
  forcedScheme,
  initialLanguage,
}: AppProvidersProps) {
  const stored = useSettingsStore((s) => s.language);
  const language = stored ?? initialLanguage ?? detectDeviceLanguage();
  const i18n = useMemo(() => createI18n(language), [language]);

  useEffect(() => {
    void useSettingsStore.getState().hydrate();
  }, []);

  return (
    <SafeAreaProvider>
      <ThemeProvider forcedScheme={forcedScheme}>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <ApiProvider value={{ client: apiClient, appVersion }}>{children}</ApiProvider>
          </QueryClientProvider>
        </I18nextProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
