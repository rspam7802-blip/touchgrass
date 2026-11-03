import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ErrorState, LoadingState, Screen, SwitchRow, Text } from '../../../components/ui';
import { useNotificationPrefs, useUpdateNotificationPrefs } from '../../../src/features/me/api';
import { QuietHoursSection } from '../../../components/QuietHoursSection';
import { errorMessage } from '../../../src/lib/errors';

/** Per-category push and in-app toggles (F-ACC-07). Safety alerts cannot be switched off. */
export default function NotificationSettingsScreen() {
  const { t } = useTranslation();
  const prefs = useNotificationPrefs();
  const update = useUpdateNotificationPrefs();
  if (prefs.isPending) {
    return (
      <Screen testID="notification-settings">
        <LoadingState />
      </Screen>
    );
  }
  if (prefs.isError) {
    return (
      <Screen testID="notification-settings">
        <ErrorState
          message={errorMessage(t, prefs.error) ?? undefined}
          onRetry={() => void prefs.refetch()}
        />
      </Screen>
    );
  }
  return (
    <Screen testID="notification-settings">
      <QuietHoursSection />
      {update.error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, update.error)}
        </Text>
      ) : null}
      {prefs.data.items.map((p) => (
        <View key={p.category} style={styles.group}>
          <Text variant="heading">{t(`settings.categories.${p.category}`)}</Text>
          <SwitchRow
            label={`${t(`settings.categories.${p.category}`)}: ${t('settings.push')}`}
            value={p.push}
            disabled={p.category === 'safety'}
            onChange={(push) => {
              update.mutate([{ ...p, push }]);
            }}
            testID={`push-${p.category}`}
          />
          <SwitchRow
            label={`${t(`settings.categories.${p.category}`)}: ${t('settings.inApp')}`}
            value={p.inApp}
            onChange={(inApp) => {
              update.mutate([{ ...p, inApp }]);
            }}
            testID={`inapp-${p.category}`}
          />
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({ group: { gap: 4 } });
