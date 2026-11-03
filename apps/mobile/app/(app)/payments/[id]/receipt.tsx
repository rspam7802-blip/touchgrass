import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ErrorState, LoadingState, Screen, Text } from '../../../../components/ui';
import { formatWhen } from '../../../../src/features/events/format';
import { useReceipt } from '../../../../src/features/payments/api';
import { money } from '../../../../src/features/payments/format';
import { errorMessage } from '../../../../src/lib/errors';
import { useTheme } from '../../../../src/theme/theme';

function Line({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View style={styles.line} accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Text style={styles.label}>{label}</Text>
      <Text variant="label">{value}</Text>
    </View>
  );
}

/** In-app receipt (F-PAY-05); the same receipt is emailed when a receipt email is set. */
export default function ReceiptScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const q = useReceipt(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const r = q.data;
  const m = (p: number): string => money(p, i18n.language);
  const refunded = r.amountPaise - r.netPaidPaise;
  return (
    <Screen testID="receipt-screen">
      <Text variant="title" accessibilityRole="header">
        {t('payments.receiptNumber', { number: r.number })}
      </Text>
      <Text tone="muted">{formatWhen(r.issuedAt, i18n.language)}</Text>
      <View
        style={[styles.card, { borderColor: theme.colors.border, borderRadius: theme.radii.md }]}
      >
        <Text variant="heading">{r.event.title}</Text>
        <Text tone="muted">{formatWhen(r.event.startsAt, i18n.language)}</Text>
        <Text tone="muted">{t('payments.hostedBy', { name: r.hostName })}</Text>
        <Line label={t('payments.amountPaid')} value={m(r.amountPaise)} testID="receipt-amount" />
        <Line label={t('payments.platformFee')} value={m(r.platformFeePaise)} />
        <Line label={t('payments.gst')} value={m(r.gstPaise)} />
        {refunded > 0 ? <Line label={t('payments.refunded')} value={`− ${m(refunded)}`} /> : null}
        <Line label={t('payments.netPaid')} value={m(r.netPaidPaise)} testID="receipt-net" />
        {r.method ? <Line label={t('payments.method')} value={r.method.toUpperCase()} /> : null}
        <Line
          label={t('payments.seller')}
          value={r.sellerGstin ? `${r.sellerName} · GSTIN ${r.sellerGstin}` : r.sellerName}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, gap: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  label: { flexShrink: 1 },
});
