import { LIMITS } from '@touchgrass/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../components/ChipGroup';
import { OnboardingStep } from '../../components/OnboardingStep';
import { ErrorState, LoadingState, Text } from '../../components/ui';
import { localized, useInterests } from '../../src/features/catalog/api';
import { useMe, useSetInterests } from '../../src/features/me/api';
import { useStepNav } from '../../src/features/me/use-step-nav';
import { errorMessage } from '../../src/lib/errors';

export default function InterestsStep() {
  const { t, i18n } = useTranslation();
  const interests = useInterests();
  const me = useMe();
  const save = useSetInterests();
  const next = useStepNav('interests');
  const [selected, setSelected] = useState<string[]>(me.data?.interests.map((i) => i.id) ?? []);

  let content;
  if (interests.isPending) content = <LoadingState />;
  else if (interests.isError)
    content = (
      <ErrorState
        message={errorMessage(t, interests.error) ?? undefined}
        onRetry={() => void interests.refetch()}
      />
    );
  else {
    content = (
      <ChipGroup
        label={t('onboarding.interestsTitle')}
        mode="multi"
        max={LIMITS.profile.maxInterests}
        options={interests.data.items.map((i) => ({
          id: i.id,
          label: `${i.emoji} ${localized(i.name, i18n.language)}`,
        }))}
        selected={selected}
        onChange={setSelected}
        testIDPrefix="interest"
      />
    );
  }

  return (
    <OnboardingStep
      step="interests"
      title={t('onboarding.interestsTitle')}
      body={t('onboarding.interestsBody', { min: LIMITS.profile.minInterests })}
      primaryDisabled={selected.length < LIMITS.profile.minInterests}
      loading={save.isPending}
      error={errorMessage(t, save.error)}
      onPrimary={() => void save.mutateAsync(selected).then(next, () => undefined)}
    >
      <Text variant="label" tone="primary" accessibilityLiveRegion="polite">
        {t('onboarding.interestsCount', { count: selected.length })}
      </Text>
      {content}
    </OnboardingStep>
  );
}
