import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { BrandLogo } from '../components/BrandLogo';
import { LanguagePicker } from '../components/LanguagePicker';
import {
  Button,
  ErrorState,
  FadeIn,
  LoadingState,
  OfflineState,
  Screen,
  Text,
} from '../components/ui';
import { useAppConfig } from '../src/features/app-config/use-app-config';
import { useIsOffline } from '../src/hooks/use-is-offline';
import { ApiError } from '../src/lib/api-client';
import { useTheme } from '../src/theme/theme';

/** Welcome: brand, value prop, language choice. Loads startup config and blocks on a forced update. */
export default function WelcomeScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const offline = useIsOffline();
  const appConfig = useAppConfig();
  const router = useRouter();
  const ready = appConfig.isSuccess && !appConfig.data.updateRequired;

  let status: React.ReactNode = null;
  if (appConfig.isPending) status = <LoadingState />;
  else if (appConfig.isError) {
    const err = appConfig.error;
    status =
      offline || (err instanceof ApiError && err.code === 'NETWORK') ? (
        <OfflineState onRetry={() => void appConfig.refetch()} />
      ) : (
        <ErrorState
          message={
            err instanceof ApiError && err.code !== 'INTERNAL' ? t(`errors.${err.code}`) : undefined
          }
          onRetry={() => void appConfig.refetch()}
        />
      );
  } else if (appConfig.data.updateRequired) {
    status = (
      <View
        testID="update-required"
        accessibilityRole="alert"
        style={[
          styles.card,
          { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.lg },
        ]}
      >
        <Text variant="heading">{t('errors.APP_UPDATE_REQUIRED')}</Text>
      </View>
    );
  }

  return (
    <Screen testID="welcome-screen">
      <FadeIn style={styles.hero} distance={18}>
        <BrandLogo size={112} />
        <Text variant="display">{t('brand.tagline')}</Text>
        <Text variant="title">{t('welcome.headline')}</Text>
        <Text tone="muted">{t('welcome.body')}</Text>
      </FadeIn>
      {status}
      {ready ? (
        <View style={styles.actions}>
          <Button
            label={t('welcome.getStarted')}
            onPress={() => {
              router.push('/phone');
            }}
            testID="get-started"
          />
          <Button
            label={t('welcome.haveInvite')}
            variant="ghost"
            onPress={() => {
              router.push('/invite');
            }}
            testID="have-invite"
          />
        </View>
      ) : null}
      <LanguagePicker />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: 16, paddingTop: 32 },
  card: { padding: 16 },
  actions: { gap: 12 },
});
