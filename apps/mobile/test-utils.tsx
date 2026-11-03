import AsyncStorage from '@react-native-async-storage/async-storage';
import { QueryClient } from '@tanstack/react-query';
import type { SupportedLanguage } from '@touchgrass/shared';
import { render, type RenderResult } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { createSessionClient } from './src/lib/session-client';
import { AppProviders } from './src/providers/app-providers';
import { useAuthFlowStore } from './src/stores/auth-flow-store';
import { useAuthStore } from './src/stores/auth-store';
import { useSettingsStore } from './src/stores/settings-store';

export interface RenderOptions {
  fetchFn?: typeof fetch;
  language?: SupportedLanguage;
  scheme?: 'light' | 'dark';
  appVersion?: string;
}

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Renders inside the real provider tree with an injectable fetch and no query retries. */
export { mockRouter, mockRouteParams } from './test/router-mock';

export async function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {},
): Promise<RenderResult & { queryClient: QueryClient }> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  const fetchFn =
    options.fetchFn ??
    (() => Promise.resolve(jsonResponse(404, { error: { code: 'NOT_FOUND', message: 'x' } })));
  const apiClient = createSessionClient('http://api.test', options.appVersion ?? '0.1.0', fetchFn);
  const result = await render(
    <AppProviders
      queryClient={queryClient}
      apiClient={apiClient}
      appVersion={options.appVersion ?? '0.1.0'}
      forcedScheme={options.scheme}
      initialLanguage={options.language ?? 'en'}
    >
      {ui}
    </AppProviders>,
  );
  return { ...result, queryClient };
}

/** Resets every client store between tests (auth session, sign-in flow, settings, secure storage). */
export function resetStores(): void {
  const secure = jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store');
  secure.__store.clear();
  void AsyncStorage.clear();
  useAuthStore.setState({ status: 'signedOut', session: null });
  useAuthFlowStore.getState().reset();
  useSettingsStore.setState({ language: null, appearance: 'system', hydrated: true });
}
