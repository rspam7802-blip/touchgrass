import { LIMITS } from '@touchgrass/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../components/ChipGroup';
import { OnboardingStep } from '../../components/OnboardingStep';
import { ErrorState, LoadingState } from '../../components/ui';
import { localized, useVibeTags } from '../../src/features/catalog/api';
import { useMe, useSetVibeTags } from '../../src/features/me/api';
import { useStepNav } from '../../src/features/me/use-step-nav';
import { errorMessage } from '../../src/lib/errors';

export default function VibesStep() {
  const { t, i18n } = useTranslation();
  const vibes = useVibeTags();
  const me = useMe();
  const save = useSetVibeTags();
  const next = useStepNav('vibes');
  const [selected, setSelected] = useState<string[]>(me.data?.vibeTags.map((v) => v.id) ?? []);

  let content;
  if (vibes.isPending) content = <LoadingState />;
  else if (vibes.isError)
    content = (
      <ErrorState
        message={errorMessage(t, vibes.error) ?? undefined}
        onRetry={() => void vibes.refetch()}
      />
    );
  else {
    content = (
      <ChipGroup
        label={t('onboarding.vibesTitle')}
        mode="multi"
        max={LIMITS.profile.maxVibeTags}
        options={vibes.data.items.map((v) => ({
          id: v.id,
          label: localized(v.name, i18n.language),
        }))}
        selected={selected}
        onChange={setSelected}
        testIDPrefix="vibe"
      />
    );
  }
  return (
    <OnboardingStep
      step="vibes"
      title={t('onboarding.vibesTitle')}
      body={t('onboarding.vibesBody', { max: LIMITS.profile.maxVibeTags })}
      primaryDisabled={selected.length === 0}
      loading={save.isPending}
      error={errorMessage(t, save.error)}
      onPrimary={() => void save.mutateAsync(selected).then(next, () => undefined)}
      secondaryLabel={t('common.skip')}
      onSecondary={next}
    >
      {content}
    </OnboardingStep>
  );
}
