import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import { BackButton } from '../../../components/BackButton';
import { ListRow, Screen, Text } from '../../../components/ui';
import { readAppEnvironment } from '../../../src/config';
import { useLogout } from '../../../src/features/auth/api';
import { openLegal } from '../../../src/features/legal/links';
import { useTutorial } from '../../../src/features/me/api';
import { useSettingsStore } from '../../../src/stores/settings-store';

export default function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const logout = useLogout();
  const tutorial = useTutorial();
  const appearance = useSettingsStore((s) => s.appearance);
  return (
    <Screen testID="settings-screen">
      <View style={styles.header}>
        <BackButton testID="settings-back" />
        <Text variant="title" accessibilityRole="header">
          {t('settings.title')}
        </Text>
      </View>
      <ListRow
        label={t('settings.notifications')}
        onPress={() => {
          router.push('/settings/notifications');
        }}
        testID="row-notifications"
      />
      <ListRow
        label={t('calendar.subscribeTitle')}
        onPress={() => {
          router.push('/settings/calendar');
        }}
        testID="row-calendar"
      />
      <ListRow
        label={t('settings.privacy')}
        onPress={() => {
          router.push('/settings/privacy');
        }}
        testID="row-privacy"
      />
      <ListRow
        label={t('settings.languageTitle')}
        detail={t(`settings.languageNames.${i18n.language as 'en' | 'te' | 'hi'}`)}
        onPress={() => {
          router.push('/settings/language');
        }}
        testID="row-language"
      />
      <ListRow
        label={t('settings.appearance')}
        detail={t(`settings.appearanceOptions.${appearance}`)}
        onPress={() => {
          router.push('/settings/appearance');
        }}
        testID="row-appearance"
      />
      <ListRow
        label={t('payments.receipts')}
        onPress={() => {
          router.push('/settings/payments');
        }}
        testID="row-payments"
      />
      <ListRow
        label={t('settings.sessions')}
        onPress={() => {
          router.push('/settings/sessions');
        }}
        testID="row-sessions"
      />
      <ListRow
        label={t('settings.replayTutorial')}
        onPress={() =>
          void tutorial.mutateAsync(false).then(
            () => {
              router.push('/tutorial');
            },
            () => undefined,
          )
        }
        testID="row-tutorial"
      />
      <ListRow
        label={t('settings.blockedUsers')}
        onPress={() => {
          router.push('/settings/blocked');
        }}
        testID="row-blocked"
      />
      <ListRow
        label={t('settings.account')}
        onPress={() => {
          router.push('/settings/account');
        }}
        testID="row-account"
      />
      <Text variant="label" accessibilityRole="header">
        {t('settings.legalTitle')}
      </Text>
      <ListRow
        label={t('settings.terms')}
        onPress={() => {
          openLegal('terms');
        }}
        testID="row-terms"
      />
      <ListRow
        label={t('settings.privacyPolicy')}
        onPress={() => {
          openLegal('privacy');
        }}
        testID="row-privacy-policy"
      />
      <ListRow
        label={t('settings.refunds')}
        onPress={() => {
          openLegal('refunds');
        }}
        testID="row-refunds"
      />
      <ListRow
        label={t('settings.contact')}
        onPress={() => {
          openLegal('contact');
        }}
        testID="row-contact"
      />
      <ListRow
        label={logout.isPending ? t('states.loading') : t('settings.logout')}
        tone="danger"
        onPress={() => {
          if (logout.isPending) return;
          Alert.alert(t('settings.logoutConfirm'), undefined, [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('settings.logout'),
              style: 'destructive',
              onPress: () => {
                logout.mutate();
              },
            },
          ]);
        }}
        testID="row-logout"
      />
      <Text variant="caption" tone="muted">
        {t('settings.version', { version: readAppEnvironment().appVersion })}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
