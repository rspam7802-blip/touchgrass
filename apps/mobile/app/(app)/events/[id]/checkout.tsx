import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../../../components/ui';
import { useEvent } from '../../../../src/features/events/api';
import { formatWhen } from '../../../../src/features/events/format';
import { useReferrals } from '../../../../src/features/engagement/api';
import { useCheckout, useReceiptEmail } from '../../../../src/features/payments/api';
import { money, refundPolicyText } from '../../../../src/features/payments/format';
import { errorMessage } from '../../../../src/lib/errors';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Paid pull-up (F-PAY-01): price, refund policy and receipt email, then the secure checkout page (UPI first)
 * opens in the browser. The seat is held for ten minutes; the status screen waits for the bank's answer.
 */
export default function CheckoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const event = useEvent(id);
  const saved = useReceiptEmail();
  const checkout = useCheckout(id);
  const rewards = useReferrals();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Once the plan put you on the waitlist there is nothing to pay for here.
  const [waitlisted, setWaitlisted] = useState(false);

  useEffect(() => {
    if (saved.data?.email) setEmail(saved.data.email);
  }, [saved.data?.email]);

  if (event.isPending) return <LoadingState />;
  if (event.isError)
    return (
      <ErrorState
        message={errorMessage(t, event.error) ?? undefined}
        onRetry={() => void event.refetch()}
      />
    );
  const e = event.data;
  const emailOk = email.trim() === '' || EMAIL.test(email.trim());

  const balance = rewards.data?.balance;
  // A free entry (referral reward, F-GRW-01) covers plans priced up to its limit.
  const canUseCredit =
    balance !== undefined && balance.credits > 0 && e.pricePaise <= balance.creditMaxPaise;

  const pay = async (useCredit = false): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      const res = await checkout.mutateAsync({
        receiptEmail: email.trim() === '' ? null : email.trim(),
        fromOffer: e.viewer.offer !== null,
        useCredit,
      });
      if (res.kind === 'waitlisted') {
        setWaitlisted(true);
        setNotice(t('events.waitlisted'));
        return;
      }
      if (res.kind === 'confirmed') {
        // Shown on the plan screen; this screen is gone after the replace.
        router.replace({ pathname: '/events/[id]', params: { id, notice: 'creditUsed' } });
        return;
      }
      await Linking.openURL(res.session.checkoutUrl);
      router.replace({
        pathname: '/payments/[id]',
        params: { id: res.session.paymentId, url: res.session.checkoutUrl },
      });
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <Screen testID="checkout-screen">
      <Text variant="title" accessibilityRole="header">
        {e.title}
      </Text>
      <Text>{formatWhen(e.startsAt, i18n.language, e.timezone)}</Text>
      <Text variant="heading" testID="checkout-price">
        {money(e.pricePaise, i18n.language)}
      </Text>
      {e.refundPolicy ? (
        <>
          <Text variant="label">{t('payments.refundPolicy')}</Text>
          <Text tone="muted" testID="checkout-refund-policy">
            {refundPolicyText(t, e.refundPolicy)}
          </Text>
        </>
      ) : null}
      <TextField
        label={t('payments.receiptEmailLabel')}
        hint={t('payments.receiptEmailHint')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        error={emailOk ? null : t('errors.VALIDATION_FAILED')}
        testID="receipt-email"
      />
      {notice ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID="checkout-notice">
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="checkout-error">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('payments.pay', { amount: money(e.pricePaise, i18n.language) })}
        loading={checkout.isPending}
        disabled={!emailOk || waitlisted}
        onPress={() => void pay()}
        testID="pay"
      />
      {canUseCredit ? (
        <Button
          label={t('referrals.useCredit')}
          variant="secondary"
          loading={checkout.isPending}
          disabled={!emailOk || waitlisted}
          onPress={() => void pay(true)}
          accessibilityHint={t('referrals.creditMax', {
            amount: money(balance.creditMaxPaise, i18n.language),
          })}
          testID="use-credit"
        />
      ) : null}
    </Screen>
  );
}
