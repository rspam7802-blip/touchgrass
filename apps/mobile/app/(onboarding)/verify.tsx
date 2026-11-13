import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { BadgeCheck } from '../../components/icons';
import { OnboardingStep } from '../../components/OnboardingStep';
import { ErrorState, IconText, LoadingState, Text } from '../../components/ui';
import { formatTime } from '../../src/features/events/format';
import { compressImage, uploadImage, waitUntilReady } from '../../src/features/media/upload';
import { useMe } from '../../src/features/me/api';
import { useStepNav } from '../../src/features/me/use-step-nav';
import {
  useMyVerification,
  useStartVerification,
  useSubmitVerification,
} from '../../src/features/safety/api';
import { takeSelfie } from '../../src/features/safety/selfie';
import { errorMessage } from '../../src/lib/errors';
import { useApi } from '../../src/providers/api-context';
import { useTheme } from '../../src/theme/theme';

/**
 * Profile setup: prove the photos are you (D-181). A random pose, a selfie copying it, then a person on our
 * team compares it with the profile photos. Sending the selfie is enough to continue; the badge follows once
 * it is reviewed.
 */
export default function VerifyStep() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const { client } = useApi();
  const me = useMe();
  const q = useMyVerification();
  const start = useStartVerification();
  const submit = useSubmitVerification();
  const next = useStepNav('verify');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (q.isPending)
    return (
      <OnboardingStep
        step="verify"
        title={t('onboarding.verifyTitle')}
        onPrimary={next}
        primaryDisabled
      >
        <LoadingState />
      </OnboardingStep>
    );
  if (q.isError)
    return (
      <OnboardingStep
        step="verify"
        title={t('onboarding.verifyTitle')}
        onPrimary={next}
        primaryDisabled
      >
        <ErrorState
          message={errorMessage(t, q.error) ?? undefined}
          onRetry={() => void q.refetch()}
        />
      </OnboardingStep>
    );

  const v = q.data;
  const sent = v.status === 'pending' || v.status === 'approved' || v.verified;
  // Not asked for right now (the team can switch the step off): nothing to do here.
  const notNeeded = !sent && me.data?.onboarding.verification === true;
  const done = sent || notNeeded;
  const challenge = v.challenge;

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
      await me.refetch();
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setBusy(false);
    }
  };

  const outOfTries = !done && !challenge && v.attemptsLeftToday === 0;
  return (
    <OnboardingStep
      step="verify"
      title={t('onboarding.verifyTitle')}
      body={t('onboarding.verifyBody')}
      primaryLabel={
        done
          ? undefined
          : challenge
            ? busy
              ? t('verification.uploading')
              : t('verification.takeSelfie')
            : v.status === 'rejected'
              ? t('verification.tryAgain')
              : t('verification.start')
      }
      primaryDisabled={outOfTries}
      loading={busy || start.isPending}
      error={error}
      onPrimary={() => {
        if (done) next();
        else if (challenge) void capture(challenge.id);
        else void begin();
      }}
    >
      {sent ? (
        <IconText icon={BadgeCheck} testID="verify-sent">
          {t(v.verified ? 'verification.approvedBody' : 'onboarding.verifySent')}
        </IconText>
      ) : null}
      {!done && v.status === 'rejected' && v.rejectReason ? (
        <Text tone="danger" testID="verify-rejected">
          {t('verification.rejectedBody', {
            reason: t(`verification.rejectReasons.${v.rejectReason}`),
          })}
        </Text>
      ) : null}
      {!done && challenge ? (
        <View
          style={[
            styles.pose,
            { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md },
          ]}
          accessible
          accessibilityLabel={`${t('verification.poseTitle')}: ${t(`verification.poses.${challenge.pose}`)}`}
        >
          <Text variant="label">{t('verification.poseTitle')}</Text>
          <Text variant="title" testID="verify-pose">
            {t(`verification.poses.${challenge.pose}`)}
          </Text>
          <Text variant="caption" tone="muted">
            {t('verification.expiresAt', { time: formatTime(challenge.expiresAt, i18n.language) })}
          </Text>
        </View>
      ) : null}
      {outOfTries ? (
        <Text tone="muted" testID="verify-out-of-tries">
          {t('verification.attemptsLeft', { count: 0 })}
        </Text>
      ) : null}
      <Text variant="caption" tone="muted">
        {t('verification.privacy')}
      </Text>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  pose: { padding: 16, gap: 6 },
});
