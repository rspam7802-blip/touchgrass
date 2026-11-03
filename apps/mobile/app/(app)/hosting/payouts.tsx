import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../../components/ui';
import { formatWhen } from '../../../src/features/events/format';
import { usePayouts } from '../../../src/features/payments/api';
import { money } from '../../../src/features/payments/format';
import { flatten } from '../../../src/features/social/api';
import { errorMessage } from '../../../src/lib/errors';
import { useTheme } from '../../../src/theme/theme';

/** Payout ledger (F-PAY-03): every paid plan's sales, refunds, fee, GST on the fee and the host's share. */
export default function PayoutsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const q = usePayouts();
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const items = flatten(q.data);
  const totals = q.data.pages[0]?.totals ?? { paidPaise: 0, pendingPaise: 0 };
  const m = (p: number): string => money(p, i18n.language);
  return (
    <Screen testID="payouts-screen">
      <Text variant="title" accessibilityRole="header">
        {t('hosting.payouts')}
      </Text>
      <Text testID="payout-totals">
        {t('hosting.paidOut')}: {m(totals.paidPaise)} · {t('hosting.pendingOut')}:{' '}
        {m(totals.pendingPaise)}
      </Text>
      {items.length === 0 ? (
        <EmptyState body={t('hosting.noPayouts')} />
      ) : (
        items.map((p) => (
          <View
            key={p.id}
            style={[
              styles.card,
              { borderColor: theme.colors.border, borderRadius: theme.radii.md },
            ]}
            testID={`payout-${p.id}`}
          >
            <Text variant="heading">{p.eventTitle}</Text>
            <Text tone={p.status === 'paid' ? 'primary' : 'muted'}>
              {t(`hosting.payoutStatus.${p.status}`)}
              {p.paidAt ? ` · ${formatWhen(p.paidAt, i18n.language)}` : ''}
            </Text>
            {p.holdReason === 'KYC_REQUIRED' ? (
              <Text tone="muted">{t('hosting.holdReasons.KYC_REQUIRED')}</Text>
            ) : null}
            <Text>
              {t('hosting.gross')}: {m(p.grossPaise)}
            </Text>
            <Text>
              {t('hosting.refunds')}: − {m(p.refundsPaise)}
            </Text>
            <Text>
              {t('hosting.fee')}: − {m(p.platformFeePaise)}
            </Text>
            <Text>
              {t('hosting.gstOnFee')}: − {m(p.gstPaise)}
            </Text>
            <Text variant="label">
              {t('hosting.net')}: {m(p.netPaise)}
            </Text>
          </View>
        ))
      )}
      {q.hasNextPage ? (
        <Button
          label={t('admin.loadMore')}
          variant="ghost"
          loading={q.isFetchingNextPage}
          onPress={() => void q.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({ card: { borderWidth: 1, padding: 12, gap: 4 } });
