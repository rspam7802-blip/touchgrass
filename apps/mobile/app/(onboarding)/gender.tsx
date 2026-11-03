import { Gender } from '@touchgrass/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../components/ChipGroup';
import { OnboardingStep } from '../../components/OnboardingStep';
import { useMe, useUpdateProfile } from '../../src/features/me/api';
import { useStepNav } from '../../src/features/me/use-step-nav';
import { errorMessage } from '../../src/lib/errors';

/** Optional; only used for women-only and balanced events, never displayed. */
export default function GenderStep() {
  const { t } = useTranslation();
  const me = useMe();
  const update = useUpdateProfile();
  const next = useStepNav('gender');
  const [gender, setGender] = useState<string[]>(me.data?.gender ? [me.data.gender] : []);
  const options = Gender.options.map((g) => ({ id: g, label: t(`onboarding.genders.${g}`) }));
  return (
    <OnboardingStep
      step="gender"
      title={t('onboarding.genderTitle')}
      body={t('onboarding.genderBody')}
      primaryDisabled={gender.length === 0}
      loading={update.isPending}
      error={errorMessage(t, update.error)}
      onPrimary={() => {
        const parsed = Gender.safeParse(gender[0]);
        if (parsed.success)
          void update.mutateAsync({ gender: parsed.data }).then(next, () => undefined);
      }}
      secondaryLabel={t('common.skip')}
      onSecondary={next}
    >
      <ChipGroup
        label={t('onboarding.genderTitle')}
        mode="single"
        options={options}
        selected={gender}
        onChange={setGender}
        testIDPrefix="gender"
      />
    </OnboardingStep>
  );
}
