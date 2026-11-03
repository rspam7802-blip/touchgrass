import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { readAppEnvironment } from '../src/config';
import { useTrack } from '../src/features/analytics/analytics';
import { useAppConfig } from '../src/features/app-config/use-app-config';
import { useTheme } from '../src/theme/theme';
import { Button, Text } from './ui';

export function storeUrl(os: string = Platform.OS): string {
  const env = readAppEnvironment();
  return os === 'ios'
    ? (env.appStoreUrl ?? env.webUrl)
    : (env.playStoreUrl ?? 'https://play.google.com/store/apps/details?id=app.touchgrass');
}

/**
 * Forced and optional updates (F-PLT-02) for signed-in people: below the minimum version the app is blocked
 * with one way out (the store); a newer version gets a dismissible banner.
 */
export function UpdatePrompt() {
  const { t } = useTranslation();
  const theme = useTheme();
  const config = useAppConfig();
  const track = useTrack();
  const [dismissed, setDismissed] = useState(false);
  const required = config.data?.updateRequired === true;
  const available = config.data?.updateAvailable === true && !dismissed;

  useEffect(() => {
    if (required || available) track('update_prompt_shown', { forced: required });
  }, [required, available, track]);

  if (required)
    return (
      <SafeAreaView
        style={[
          StyleSheet.absoluteFill,
          styles.block,
          { backgroundColor: theme.colors.background },
        ]}
        testID="update-required-gate"
      >
        <Text variant="title" accessibilityRole="alert">
          {t('errors.APP_UPDATE_REQUIRED')}
        </Text>
        <Button
          label={t('app.update')}
          onPress={() => void Linking.openURL(storeUrl())}
          testID="update-now"
        />
      </SafeAreaView>
    );
  if (!available) return null;
  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.banner, { backgroundColor: theme.colors.surfaceAlt }]}
      testID="update-available"
    >
      <View style={styles.row}>
        <Text style={styles.grow} accessibilityRole="alert">
          {t('app.updateAvailable')}
        </Text>
        <Button
          label={t('app.update')}
          variant="secondary"
          onPress={() => void Linking.openURL(storeUrl())}
          testID="update-banner-open"
        />
        <Button
          label={t('app.later')}
          variant="ghost"
          onPress={() => {
            setDismissed(true);
          }}
          testID="update-banner-later"
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  block: { zIndex: 100, padding: 24, gap: 16, justifyContent: 'center' },
  banner: { paddingHorizontal: 16, paddingBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  grow: { flex: 1 },
});
