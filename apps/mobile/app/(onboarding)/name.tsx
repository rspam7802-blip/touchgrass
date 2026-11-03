import { LIMITS } from '@touchgrass/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OnboardingStep } from '../../components/OnboardingStep';
import { TextField } from '../../components/ui';
import { useMe, useUpdateProfile } from '../../src/features/me/api';
import { useStepNav } from '../../src/features/me/use-step-nav';
import { errorMessage } from '../../src/lib/errors';

export default function NameStep() {
  const { t } = useTranslation();
  const me = useMe();
  const update = useUpdateProfile();
  const next = useStepNav('name');
  const [name, setName] = useState(me.data?.displayName ?? '');
  const [pronouns, setPronouns] = useState(me.data?.pronouns ?? '');
  const valid = name.trim().length >= LIMITS.profile.displayNameMin;

  return (
    <OnboardingStep
      step="name"
      title={t('onboarding.nameTitle')}
      primaryDisabled={!valid}
      loading={update.isPending}
      error={errorMessage(t, update.error)}
      onPrimary={() => {
        void update
          .mutateAsync({ displayName: name.trim(), pronouns: pronouns.trim() || null })
          .then(next, () => undefined);
      }}
    >
      <TextField
        label={t('onboarding.nameLabel')}
        value={name}
        onChangeText={setName}
        maxLength={LIMITS.profile.displayNameMax}
        autoComplete="name"
        testID="name-input"
      />
      <TextField
        label={t('onboarding.pronounsLabel')}
        value={pronouns}
        onChangeText={setPronouns}
        maxLength={LIMITS.profile.pronounsMax}
        testID="pronouns-input"
      />
    </OnboardingStep>
  );
}
