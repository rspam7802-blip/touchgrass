import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, LoadingState, Screen, Text } from '../../components/ui';
import { useClaimPlusOne } from '../../src/features/events/api';
import { errorMessage } from '../../src/lib/errors';
import { useAuthFlowStore } from '../../src/stores/auth-flow-store';
import { appArea, useAuthStore } from '../../src/stores/auth-store';

/**
 * Guest +1 claim links (F-EVT-07). Signed out: the token rides along through sign-up instead of an invite
 * code. Signed in: the seat is claimed straight away and the plan opens.
 */
export default function ClaimRoute() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const area = useAuthStore((s) => appArea(s.status, s.session?.user));
  const claim = useClaimPlusOne();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (area === 'public') {
      useAuthFlowStore.getState().setClaimToken(token);
      router.replace('/phone');
    }
  }, [area, router, token]);

  if (area === 'loading' || area === 'public') return <LoadingState />;
  return (
    <Screen testID="claim-screen">
      <Text variant="title" accessibilityRole="header">
        {t('events.claimPlusOneTitle')}
      </Text>
      {area === 'onboarding' ? <Text>{t('events.finishOnboardingFirst')}</Text> : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="claim-error">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('events.claimSpot')}
        disabled={area !== 'app'}
        loading={claim.isPending}
        testID="claim-plus-one"
        onPress={() => {
          claim.mutateAsync(token).then(
            (r) => {
              router.replace({ pathname: '/events/[id]', params: { id: r.eventId } });
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
