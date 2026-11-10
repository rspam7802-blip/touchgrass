import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme/theme';

/**
 * Makes `(onboarding)` one route of the root stack, so the root layout's Stack.Protected guard can show or remove
 * the whole group. Without it the guard matched nothing and these screens stayed reachable from any area.
 */
export default function OnboardingLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    />
  );
}
