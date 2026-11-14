import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme/theme';

/**
 * The group always opens on `start`, which sends people to their first unfinished step. Right after sign-in the
 * root asks for `/start` in the same moment the group appears; if that request lands first it is dropped, and
 * without this the stack opened on an arbitrary step (seen in the Maestro run: a new member landed on "Where
 * are you?", skipping name, photos, selfie and birthday).
 */
export const unstable_settings = { initialRouteName: 'start' };

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
