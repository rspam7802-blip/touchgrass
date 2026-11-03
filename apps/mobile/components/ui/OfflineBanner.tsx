import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useIsOffline } from '../../src/hooks/use-is-offline';
import { useTheme } from '../../src/theme/theme';
import { Text } from './Text';

/** Shown on every screen while offline (F-PLT-04). Announced politely to screen readers. */
export function OfflineBanner() {
  const offline = useIsOffline();
  const { t } = useTranslation();
  const theme = useTheme();
  if (!offline) return null;
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[
        styles.banner,
        {
          backgroundColor: theme.colors.accent,
          paddingHorizontal: theme.spacing.lg,
          paddingVertical: theme.spacing.sm,
        },
      ]}
    >
      <Text variant="label" style={{ color: theme.colors.onAccent }}>
        {t('states.offlineBanner')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({ banner: { width: '100%' } });
