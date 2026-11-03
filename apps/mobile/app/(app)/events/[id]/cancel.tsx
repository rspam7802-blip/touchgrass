import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Screen, Text, TextField } from '../../../../components/ui';
import { useCancelEvent } from '../../../../src/features/events/api';
import { errorMessage } from '../../../../src/lib/errors';

/** Host cancels the plan (F-EVT-16); everyone going is told, with the reason. */
export default function CancelEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const cancel = useCancelEvent(id);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Screen testID="cancel-event-screen">
      <Text variant="title" accessibilityRole="header">
        {t('events.cancelEvent')}
      </Text>
      <Text>{t('events.cancelConfirm')}</Text>
      <TextField
        label={t('events.cancelReason')}
        value={reason}
        onChangeText={setReason}
        maxLength={500}
        multiline
        testID="cancel-reason"
      />
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('events.cancelEvent')}
        variant="danger"
        loading={cancel.isPending}
        testID="confirm-cancel"
        onPress={() => {
          cancel.mutateAsync(reason.trim()).then(
            () => {
              router.back();
            },
            (err: unknown) => {
              setError(errorMessage(t, err));
            },
          );
        }}
      />
    </Screen>
  );
}
