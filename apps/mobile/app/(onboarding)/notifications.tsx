import { useMutation } from '@tanstack/react-query';
import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { OnboardingStep } from '../../components/OnboardingStep';
import { readAppEnvironment } from '../../src/config';
import { useRecordConsent, useRegisterDevice } from '../../src/features/me/api';
import { useStepNav } from '../../src/features/me/use-step-nav';
import { PERMISSION_CONSENT_VERSION, requestPushPermission } from '../../src/features/permissions';
import { errorMessage } from '../../src/lib/errors';

export default function NotificationsStep() {
  const { t } = useTranslation();
  const next = useStepNav('notifications');
  const consent = useRecordConsent();
  const register = useRegisterDevice();
  const allow = useMutation({
    mutationFn: async () => {
      const res = await requestPushPermission(readAppEnvironment().eas?.projectId);
      await consent.mutateAsync({
        kind: 'notifications',
        granted: res.granted,
        version: PERMISSION_CONSENT_VERSION,
      });
      if (res.token)
        await register.mutateAsync({
          expoPushToken: res.token,
          platform: Platform.OS === 'ios' ? 'ios' : 'android',
        });
    },
    onSuccess: next,
  });
  return (
    <OnboardingStep
      step="notifications"
      title={t('onboarding.notificationsTitle')}
      body={t('onboarding.notificationsBody')}
      primaryLabel={t('onboarding.allowNotifications')}
      loading={allow.isPending}
      error={errorMessage(t, allow.error)}
      onPrimary={() => {
        allow.mutate();
      }}
      secondaryLabel={t('onboarding.notNow')}
      onSecondary={() =>
        void consent
          .mutateAsync({
            kind: 'notifications',
            granted: false,
            version: PERMISSION_CONSENT_VERSION,
          })
          .then(next, () => undefined)
      }
    />
  );
}
