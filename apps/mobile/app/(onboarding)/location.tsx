import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { OnboardingStep } from '../../components/OnboardingStep';
import { useCompleteOnboarding, useRecordConsent } from '../../src/features/me/api';
import {
  PERMISSION_CONSENT_VERSION,
  requestLocationPermission,
} from '../../src/features/permissions';
import { errorMessage } from '../../src/lib/errors';

/** Last step: records the location decision and completes onboarding (account becomes active). */
export default function LocationStep() {
  const { t } = useTranslation();
  const consent = useRecordConsent();
  const complete = useCompleteOnboarding();
  const finish = useMutation({
    mutationFn: async (ask: boolean) => {
      const granted = ask ? await requestLocationPermission() : false;
      await consent.mutateAsync({ kind: 'location', granted, version: PERMISSION_CONSENT_VERSION });
      await complete.mutateAsync();
    },
  });
  return (
    <OnboardingStep
      step="location"
      title={t('onboarding.locationTitle')}
      body={t('onboarding.locationBody')}
      primaryLabel={t('onboarding.allowLocation')}
      loading={finish.isPending}
      error={errorMessage(t, finish.error)}
      onPrimary={() => {
        finish.mutate(true);
      }}
      secondaryLabel={t('onboarding.notNow')}
      onSecondary={() => {
        finish.mutate(false);
      }}
    />
  );
}
