import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../../components/ui';
import { formatWhen } from '../../../src/features/events/format';
import {
  usePayments,
  useReceiptEmail,
  useSetReceiptEmail,
} from '../../../src/features/payments/api';
import { money } from '../../../src/features/payments/format';
import { flatten } from '../../../src/features/social/api';
import { errorMessage } from '../../../src/lib/errors';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Payment history, receipts and the receipt email (F-PAY-05). */
export default function PaymentsSettingsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const q = usePayments();
  const saved = useReceiptEmail();
  const save = useSetReceiptEmail();
  const [email, setEmail] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (saved.data) setEmail(saved.data.email ?? '');
  }, [saved.data]);
  const valid = email.trim() === '' || EMAIL.test(email.trim());

  return (
    <Screen testID="payments-settings">
      <Text variant="title" accessibilityRole="header">
        {t('payments.receipts')}
      </Text>
      <TextField
        label={t('payments.receiptEmailLabel')}
        hint={t('payments.receiptEmailHint')}
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        error={valid ? null : t('errors.VALIDATION_FAILED')}
        testID="settings-receipt-email"
      />
      <Button
        label={t('admin.save')}
        variant="secondary"
        disabled={!valid}
        loading={save.isPending}
        onPress={() => {
          setNotice(null);
          save.mutate(email.trim() === '' ? null : email.trim(), {
            onSuccess: () => {
              setNotice(t('admin.saved'));
            },
            onError: (err) => {
              setNotice(errorMessage(t, err));
            },
          });
        }}
        testID="save-receipt-email"
      />
      {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState
          message={errorMessage(t, q.error) ?? undefined}
          onRetry={() => void q.refetch()}
        />
      ) : flatten(q.data).length === 0 ? (
        <EmptyState body={t('payments.noPayments')} />
      ) : (
        <>
          {flatten(q.data).map((p) => (
            <ListRow
              key={p.id}
              label={p.eventTitle}
              detail={`${money(p.amountPaise, i18n.language)} · ${t(`payments.status.${p.status}`)} · ${formatWhen(p.createdAt, i18n.language)}`}
              onPress={() => {
                router.push({ pathname: '/payments/[id]', params: { id: p.id } });
              }}
              testID={`payment-${p.id}`}
            />
          ))}
          {q.hasNextPage ? (
            <Button
              label={t('admin.loadMore')}
              variant="ghost"
              loading={q.isFetchingNextPage}
              onPress={() => void q.fetchNextPage()}
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}
