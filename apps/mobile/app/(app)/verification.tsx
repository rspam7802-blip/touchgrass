import type { MyVerification } from '@touchgrass/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, ErrorState, LoadingState, Screen, Text } from '../../components/ui';
import { formatTime } from '../../src/features/events/format';
import { compressImage, uploadImage, waitUntilReady } from '../../src/features/media/upload';
import {
  useMyVerification,
  useStartVerification,
  useSubmitVerification,
} from '../../src/features/safety/api';
import { takeSelfie } from '../../src/features/safety/selfie';
import { errorMessage } from '../../src/lib/errors';
import { useApi } from '../../src/providers/api-context';
import { useTheme } from '../../src/theme/theme';

function statusBody(t: ReturnType<typeof useTranslation>['t'], v: MyVerification): string | null {
  if (v.status === 'pending') return t('verification.pendingBody');
  if (v.status === 'approved') return t('verification.approvedBody');
  if (v.status === 'rejected' && v.rejectReason)
    return t('verification.rejectedBody', {
      reason: t(`verification.rejectReasons.${v.rejectReason}`),
    });
  return null;
}

/** Get verified (F-SAF-01): a random pose, a selfie copying it, then a person reviews it. */
export default function VerificationScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { client } = useApi();
  const q = useMyVerification();
  const start = useStartVerification();
  const submit = useSubmitVerification();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const v = q.data;
  const body = statusBody(t, v);

  const begin = async (): Promise<void> => {
    setError(null);
    try {
      await start.mutateAsync();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const capture = async (challengeId: string): Promise<void> => {
    setError(null);
    const uri = await takeSelfie();
    if (!uri) {
      setError(t('verification.cameraDenied'));
      return;
    }
    setBusy(true);
    try {
      const asset = await uploadImage(client, 'verification_selfie', await compressImage(uri));
      if (!(await waitUntilReady(client, asset, 20))) throw new Error('not ready');
      await submit.mutateAsync({ challengeId, mediaId: asset.id });
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="verification-screen">
      <Text>{t('verification.intro')}</Text>
      <Text tone="muted">{t('verification.why')}</Text>
      <Text variant="heading" accessibilityRole="header" testID="verification-status">
        {t(`verification.status.${v.status}`)}
      </Text>
      {body ? <Text testID="verification-body">{body}</Text> : null}

      {v.challenge ? (
        <View
          style={[
            styles.pose,
            { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md },
          ]}
          accessible
          accessibilityLabel={`${t('verification.poseTitle')}: ${t(`verification.poses.${v.challenge.pose}`)}`}
        >
          <Text variant="label">{t('verification.poseTitle')}</Text>
          <Text variant="title" testID="verification-pose">
            {t(`verification.poses.${v.challenge.pose}`)}
          </Text>
          <Text variant="caption" tone="muted">
            {t('verification.expiresAt', {
              time: formatTime(v.challenge.expiresAt, i18n.language),
            })}
          </Text>
        </View>
      ) : null}
      {v.challenge ? (
        <Button
          label={busy ? t('verification.uploading') : t('verification.takeSelfie')}
          loading={busy}
          onPress={() => {
            if (v.challenge) void capture(v.challenge.id);
          }}
          testID="verification-selfie"
        />
      ) : null}
      {!v.verified && !v.challenge && v.status !== 'pending' ? (
        <>
          <Text variant="caption" tone="muted" testID="verification-attempts">
            {t('verification.attemptsLeft', { count: v.attemptsLeftToday })}
          </Text>
          <Button
            label={v.status === 'rejected' ? t('verification.tryAgain') : t('verification.start')}
            disabled={v.attemptsLeftToday === 0}
            loading={start.isPending}
            onPress={() => void begin()}
            testID="verification-start"
          />
        </>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="verification-error">
          {error}
        </Text>
      ) : null}
      <Text variant="caption" tone="muted">
        {t('verification.privacy')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  pose: { padding: 16, gap: 6 },
});
