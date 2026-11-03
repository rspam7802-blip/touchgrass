import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { OnboardingStep } from '../../components/OnboardingStep';
import { useRecordConsent } from '../../src/features/me/api';
import { useStepNav } from '../../src/features/me/use-step-nav';
import {
  PERMISSION_CONSENT_VERSION,
  requestContactsPermission,
} from '../../src/features/permissions';
import { errorMessage } from '../../src/lib/errors';

/** Optional. Contact matching itself (hashed numbers only) runs in the Squad section (Phase 2). */
export default function ContactsStep() {
  const { t } = useTranslation();
  const next = useStepNav('contacts');
  const consent = useRecordConsent();
  const decide = useMutation({
    mutationFn: async (ask: boolean) => {
      const granted = ask ? await requestContactsPermission() : false;
      await consent.mutateAsync({ kind: 'contacts', granted, version: PERMISSION_CONSENT_VERSION });
    },
    onSuccess: next,
  });
  return (
    <OnboardingStep
      step="contacts"
      title={t('onboarding.contactsTitle')}
      body={t('onboarding.contactsBody')}
      primaryLabel={t('onboarding.allowContacts')}
      loading={decide.isPending}
      error={errorMessage(t, decide.error)}
      onPrimary={() => {
        decide.mutate(true);
      }}
      secondaryLabel={t('onboarding.notNow')}
      onSecondary={() => {
        decide.mutate(false);
      }}
    />
  );
}
