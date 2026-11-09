import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ErrorState, LoadingState, Screen, Text } from '../../../../components/ui';
import { formatTime, formatWhen } from '../../../../src/features/events/format';
import { useCancelCheckout, useCheckout, usePayment } from '../../../../src/features/payments/api';
import { money } from '../../../../src/features/payments/format';
import { errorMessage } from '../../../../src/lib/errors';

/**
 * Where the checkout returns (touchgrass://payments/:id). Waits for the verified webhook (polls every 3 s), then
 * shows the ticket and receipt. Failed payments can be retried until the ten-minute hold ends.
 */
export default function PaymentStatusScreen() {
  const { id, url } = useLocalSearchParams<{ id: string; url?: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const q = usePayment(id);
  const cancel = useCancelCheckout(id);
  const checkout = useCheckout(q.data?.eventId ?? '');
  const [error, setError] = useState<string | null>(null);

  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const p = q.data;
  const holdOpen =
    (p.status === 'created' || p.status === 'failed') &&
    new Date(p.holdExpiresAt).getTime() > Date.now();

  const payAgain = async (): Promise<void> => {
    setError(null);
    try {
      if (url) {
        await Linking.openURL(url);
        return;
      }
      const res = await checkout.mutateAsync({ receiptEmail: null, fromOffer: false });
      if (res.kind === 'checkout') await Linking.openURL(res.session.checkoutUrl);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const message =
    p.status === 'captured'
      ? t('payments.paid')
      : p.status === 'failed'
        ? t('payments.failed')
        : p.status === 'expired'
          ? t('payments.holdExpired')
          : p.status === 'created'
            ? t('payments.checkingPayment')
            : t(`payments.status.${p.status}`);

  return (
    <Screen testID="payment-screen">
      <Text variant="title" accessibilityRole="header">
        {p.eventTitle}
      </Text>
      <Text>{formatWhen(p.eventStartsAt, i18n.language, p.eventTimezone)}</Text>
      <Text variant="heading">{money(p.amountPaise, i18n.language)}</Text>
      <Text
        tone={p.status === 'failed' || p.status === 'expired' ? 'danger' : 'primary'}
        accessibilityLiveRegion="polite"
        testID="payment-status"
      >
        {message}
      </Text>
      {holdOpen ? (
        <>
          <Text tone="muted">
            {t('payments.holdNotice', { time: formatTime(p.holdExpiresAt, i18n.language) })}
          </Text>
          <Button
            label={p.status === 'failed' ? t('payments.retry') : t('payments.payNow')}
            loading={checkout.isPending}
            onPress={() => void payAgain()}
            testID="pay-again"
          />
          <Button
            label={t('common.cancel')}
            variant="ghost"
            loading={cancel.isPending}
            onPress={() => {
              setError(null);
              cancel.mutate(undefined, {
                onSuccess: () => {
                  router.back();
                },
                onError: (err) => {
                  setError(errorMessage(t, err));
                },
              });
            }}
            testID="cancel-checkout"
          />
        </>
      ) : null}
      {p.status === 'captured' || p.status === 'partially_refunded' ? (
        <>
          <Button
            label={t('events.ticket')}
            onPress={() => {
              router.push({ pathname: '/events/[id]/ticket', params: { id: p.eventId } });
            }}
            testID="open-ticket"
          />
          <Button
            label={t('payments.receipt')}
            variant="secondary"
            onPress={() => {
              router.push({ pathname: '/payments/[id]/receipt', params: { id: p.id } });
            }}
            testID="open-receipt"
          />
        </>
      ) : null}
      {p.refunds.map((r) => (
        <Text key={r.id} tone="muted">
          {t(`payments.refundStatus.${r.status}`)} · {money(r.amountPaise, i18n.language)}
        </Text>
      ))}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
