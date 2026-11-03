import * as Sharing from 'expo-sharing';
import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { captureRef } from 'react-native-view-shot';
import { RecapCard, type RecapCardRef } from '../../../components/engagement/RecapCard';
import { Button, ErrorState, LoadingState, Screen, Text } from '../../../components/ui';
import { useRecap } from '../../../src/features/engagement/api';
import { errorMessage } from '../../../src/lib/errors';

/** One recap (F-GAM-04): the 9:16 card, shared as an image to Instagram Stories or WhatsApp. */
export default function RecapScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const q = useRecap(id);
  const card = useRef<RecapCardRef>(null);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const share = async (): Promise<void> => {
    setError(null);
    setSharing(true);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('no share sheet');
      const uri = await captureRef(card, { format: 'png', quality: 1, width: 1080, height: 1920 });
      await Sharing.shareAsync(uri, { mimeType: 'image/png' });
    } catch {
      setError(t('recap.shareFailed'));
    } finally {
      setSharing(false);
    }
  };
  return (
    <Screen testID="recap-screen">
      <RecapCard ref={card} recap={q.data} />
      {error ? (
        <Text tone="danger" accessibilityRole="alert" testID="recap-error">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('recap.share')}
        loading={sharing}
        onPress={() => void share()}
        testID="recap-share"
      />
    </Screen>
  );
}
