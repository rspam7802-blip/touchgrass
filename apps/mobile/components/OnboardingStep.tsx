import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Screen, Text } from './ui';
import { useLogout } from '../src/features/auth/api';
import { useTheme } from '../src/theme/theme';

export const ONBOARDING_STEPS = [
  'name',
  'photos',
  'verify',
  'birthday',
  'gender',
  'city',
  'neighbourhood',
  'interests',
  'vibes',
  'notifications',
  'contacts',
  'location',
] as const;
export type OnboardingStepName = (typeof ONBOARDING_STEPS)[number];

export interface OnboardingStepProps {
  step: OnboardingStepName;
  title: string;
  body?: string;
  children?: ReactNode;
  primaryLabel?: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  loading?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  error?: string | null;
}

/** Shared layout for every onboarding step: progress, title, content, primary + optional skip. */
export function OnboardingStep(props: OnboardingStepProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const logout = useLogout();
  const index = ONBOARDING_STEPS.indexOf(props.step) + 1;
  return (
    <Screen testID={`onboarding-${props.step}`}>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={t('onboarding.step', {
          current: index,
          total: ONBOARDING_STEPS.length,
        })}
        accessibilityValue={{ min: 0, max: ONBOARDING_STEPS.length, now: index }}
        style={[
          styles.track,
          { backgroundColor: theme.colors.border, borderRadius: theme.radii.pill },
        ]}
      >
        <View
          style={[
            styles.fill,
            {
              width: `${(index / ONBOARDING_STEPS.length) * 100}%`,
              backgroundColor: theme.colors.primary,
              borderRadius: theme.radii.pill,
            },
          ]}
        />
      </View>
      <Text variant="caption" tone="muted">
        {t('onboarding.step', { current: index, total: ONBOARDING_STEPS.length })}
      </Text>
      <Text variant="title">{props.title}</Text>
      {props.body ? <Text tone="muted">{props.body}</Text> : null}
      <View style={styles.content}>{props.children}</View>
      {props.error ? (
        <Text tone="danger" accessibilityRole="alert">
          {props.error}
        </Text>
      ) : null}
      <Button
        label={props.primaryLabel ?? t('common.continue')}
        onPress={props.onPrimary}
        disabled={props.primaryDisabled}
        loading={props.loading}
        testID="onboarding-primary"
      />
      {props.secondaryLabel && props.onSecondary ? (
        <Button
          label={props.secondaryLabel}
          variant="ghost"
          onPress={props.onSecondary}
          testID="onboarding-secondary"
        />
      ) : null}
      {/* A way out at every step (wrong number, someone else's phone, stuck on a permission). */}
      <Button
        label={t('states.signOut')}
        variant="ghost"
        loading={logout.isPending}
        onPress={() => {
          logout.mutate();
        }}
        testID="onboarding-sign-out"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  track: { height: 6, width: '100%', overflow: 'hidden' },
  fill: { height: 6 },
  // No flexGrow: Continue sits right under the fields, so it stays above the keyboard while typing a name or
  // birthday (it was pinned to the bottom of the screen, under the keyboard).
  content: { gap: 12 },
});
