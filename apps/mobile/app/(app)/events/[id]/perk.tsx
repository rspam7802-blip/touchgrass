import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { QrCode } from '../../../../components/QrCode';
import { ErrorState, LoadingState, Screen, Text } from '../../../../components/ui';
import { formatTime } from '../../../../src/features/events/format';
import { usePerkPass } from '../../../../src/features/payments/api';
import { errorMessage } from '../../../../src/lib/errors';

/** Perk pass (F-PAY-04): staff scan the QR (or type the code) and confirm with the venue PIN. */
export default function PerkScreen() {
  const { id, perkId } = useLocalSearchParams<{ id: string; perkId: string }>();
  const { t, i18n } = useTranslation();
  const q = usePerkPass(id, perkId);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const p = q.data;
  return (
    <Screen testID="perk-screen">
      <Text variant="title" accessibilityRole="header">
        {p.perkTitle}
      </Text>
      <Text tone="muted">{p.venueName}</Text>
      {p.redeemedAt ? (
        <Text tone="primary" testID="perk-redeemed">
          {t('perks.redeemed', { time: formatTime(p.redeemedAt, i18n.language) })}
        </Text>
      ) : (
        <>
          <Text>{t('perks.showStaff')}</Text>
          <View style={styles.qr}>
            <QrCode value={p.qr} size={240} label={t('perks.code', { code: p.code })} />
          </View>
          <Text
            variant="title"
            style={styles.code}
            testID="perk-code"
            accessibilityLabel={t('perks.code', { code: p.code.split('').join(' ') })}
          >
            {p.code}
          </Text>
          <Text tone="muted">
            {t('perks.validUntil', { time: formatTime(p.expiresAt, i18n.language) })}
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  qr: { alignItems: 'center', padding: 16, backgroundColor: '#FFFFFF' },
  code: { textAlign: 'center', letterSpacing: 6 },
});
