import { LIMITS } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Linking from 'expo-linking';
import { StyleSheet, View } from 'react-native';
import { SosButton } from '../../../components/SosButton';
import { Button, Screen, Text } from '../../../components/ui';
import { useMe } from '../../../src/features/me/api';
import { useLiveShare, useMyVerification } from '../../../src/features/safety/api';
import { formatTime } from '../../../src/features/events/format';
import { useTheme } from '../../../src/theme/theme';

const TIPS = ['public', 'tell', 'own_way', 'drinks', 'leave', 'report'] as const;
const SAFETY_EMAIL = 'safety@touchgrass.app';

/** Safety centre (F-SAF-07): emergency numbers, live location and SOS, verification, tips and reporting. */
export default function SafetyCentreScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const me = useMe();
  const verification = useMyVerification();
  const live = useLiveShare();
  const share = live.data?.share ?? null;
  const box = [
    styles.box,
    { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md },
  ];

  return (
    <Screen testID="safety-screen">
      <Text>{t('safety.intro')}</Text>

      <Text variant="heading" accessibilityRole="header">
        {t('safety.emergencyTitle')}
      </Text>
      <SosButton testID="safety-sos" />
      <View style={box}>
        {LIMITS.safety.helplines.map((h) => (
          <Button
            key={h.key}
            label={`${t(`safety.helplines.${h.key}`)} · ${h.number}`}
            variant="ghost"
            accessibilityLabel={`${t(`safety.helplines.${h.key}`)}: ${t('safety.call', { number: h.number })}`}
            accessibilityHint={t('safety.callHint')}
            onPress={() => void Linking.openURL(`tel:${h.number}`)}
            testID={`helpline-${h.key}`}
          />
        ))}
      </View>

      <Text variant="heading" accessibilityRole="header">
        {t('safety.shareTitle')}
      </Text>
      {share?.active ? (
        <Text testID="safety-sharing">
          {t('safety.sharing')} ·{' '}
          {t('safety.sharingUntil', { time: formatTime(share.expiresAt, i18n.language) })}
        </Text>
      ) : (
        <Text tone="muted">{t('safety.shareBody')}</Text>
      )}
      <Button
        label={share?.active ? t('safety.sharing') : t('safety.start')}
        onPress={() => {
          router.push('/safety/share');
        }}
        testID="safety-open-share"
      />
      <Button
        label={t('safety.manageContacts')}
        variant="secondary"
        onPress={() => {
          router.push('/safety/contacts');
        }}
        testID="safety-open-contacts"
      />

      <Text variant="heading" accessibilityRole="header">
        {t('safety.verifyTitle')}
      </Text>
      <Text>{t('safety.verifyBody')}</Text>
      {verification.data ? (
        <Text testID="safety-verify-status">
          {t('safety.verifyStatus', {
            status: t(`verification.status.${verification.data.status}`),
          })}
        </Text>
      ) : null}
      {me.data && !me.data.verified ? (
        <Button
          label={t('safety.verifyCta')}
          variant="secondary"
          onPress={() => {
            router.push('/verification');
          }}
          testID="safety-open-verification"
        />
      ) : null}

      <Text variant="heading" accessibilityRole="header">
        {t('safety.tipsTitle')}
      </Text>
      <View style={box}>
        {TIPS.map((tip) => (
          <Text key={tip}>• {t(`safety.tips.${tip}`)}</Text>
        ))}
      </View>

      <Text variant="heading" accessibilityRole="header">
        {t('safety.reportTitle')}
      </Text>
      <Text>{t('safety.reportBody')}</Text>
      <Button
        label={t('safety.reportCta')}
        variant="secondary"
        onPress={() =>
          void Linking.openURL(
            `mailto:${SAFETY_EMAIL}?subject=${encodeURIComponent(t('safety.reportSubject'))}`,
          )
        }
        testID="safety-report"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  box: { padding: 12, gap: 6 },
});
