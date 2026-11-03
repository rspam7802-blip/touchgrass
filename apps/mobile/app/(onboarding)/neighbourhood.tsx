import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../components/ChipGroup';
import { OnboardingStep } from '../../components/OnboardingStep';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui';
import { useNeighbourhoods } from '../../src/features/catalog/api';
import { useMe, useUpdateProfile } from '../../src/features/me/api';
import { useStepNav } from '../../src/features/me/use-step-nav';
import { errorMessage } from '../../src/lib/errors';

export default function NeighbourhoodStep() {
  const { t } = useTranslation();
  const me = useMe();
  const hoods = useNeighbourhoods(me.data?.cityId ?? null);
  const update = useUpdateProfile();
  const next = useStepNav('neighbourhood');
  const [selected, setSelected] = useState<string[]>(
    me.data?.neighbourhoodId ? [me.data.neighbourhoodId] : [],
  );

  let content;
  if (me.isPending || hoods.isPending) content = <LoadingState />;
  else if (hoods.isError)
    content = (
      <ErrorState
        message={errorMessage(t, hoods.error) ?? undefined}
        onRetry={() => void hoods.refetch()}
      />
    );
  else if (hoods.data.items.length === 0) content = <EmptyState />;
  else {
    content = (
      <ChipGroup
        label={t('onboarding.neighbourhoodTitle')}
        mode="single"
        options={hoods.data.items.map((n) => ({ id: n.id, label: n.name }))}
        selected={selected}
        onChange={setSelected}
        testIDPrefix="hood"
      />
    );
  }

  return (
    <OnboardingStep
      step="neighbourhood"
      title={t('onboarding.neighbourhoodTitle')}
      body={t('onboarding.neighbourhoodBody')}
      primaryDisabled={selected.length === 0}
      loading={update.isPending}
      error={errorMessage(t, update.error)}
      onPrimary={() => {
        const [neighbourhoodId] = selected;
        if (neighbourhoodId)
          void update.mutateAsync({ neighbourhoodId }).then(next, () => undefined);
      }}
      secondaryLabel={t('common.skip')}
      onSecondary={next}
    >
      {content}
    </OnboardingStep>
  );
}
