import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingState, Screen } from '../../components/ui';
import { useMe } from '../../src/features/me/api';
import { resumeStep, stepRoute } from '../../src/features/me/onboarding';
import { errorMessage } from '../../src/lib/errors';

/** Resumes onboarding at the first unfinished step (e.g. after the app was closed mid-way). */
export default function OnboardingStart() {
  const { t } = useTranslation();
  const me = useMe();
  if (me.isPending) {
    return (
      <Screen testID="onboarding-start">
        <LoadingState />
      </Screen>
    );
  }
  if (me.isError) {
    return (
      <Screen testID="onboarding-start">
        <ErrorState
          message={errorMessage(t, me.error) ?? undefined}
          onRetry={() => void me.refetch()}
        />
      </Screen>
    );
  }
  return <Redirect href={stepRoute(resumeStep(me.data.onboarding))} />;
}
