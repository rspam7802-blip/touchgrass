import type { ReactNode } from 'react';
import { Text } from 'react-native';

/** Shared expo-router double: assert on navigation calls and set route params per test. */
export const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
};
export const mockRouteParams: { current: Record<string, string> } = { current: {} };

function Passthrough({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
const Navigator = Object.assign(Passthrough, { Screen: () => null, Protected: Passthrough });

export const expoRouterMock = {
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockRouteParams.current,
  Redirect: ({ href }: { href: string }) => <Text testID="redirect">{href}</Text>,
  Stack: Navigator,
  Tabs: Navigator,
};
