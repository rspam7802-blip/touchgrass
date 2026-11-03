import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../components/ChipGroup';
import { OnboardingStep } from '../../components/OnboardingStep';
import { Button, ErrorState, LoadingState, TextField } from '../../components/ui';
import { useCities, useCityWaitlist, useJoinCityWaitlist } from '../../src/features/catalog/api';
import { useMe, useUpdateProfile } from '../../src/features/me/api';
import { useStepNav } from '../../src/features/me/use-step-nav';
import { errorMessage } from '../../src/lib/errors';

/**
 * Pick your city (F-GRW-03). Open cities continue onboarding; a city that isn't open yet, or one that
 * isn't on TouchGrass at all, puts you on its waitlist instead.
 */
export default function CityStep() {
  const { t } = useTranslation();
  const router = useRouter();
  const { change } = useLocalSearchParams<{ change?: string }>();
  const cities = useCities();
  const me = useMe();
  const waitlist = useCityWaitlist();
  const update = useUpdateProfile();
  const join = useJoinCityWaitlist();
  const next = useStepNav('city');
  const [selected, setSelected] = useState<string[]>(me.data?.cityId ? [me.data.cityId] : []);
  const [other, setOther] = useState<string | null>(null);

  const waitingFor = waitlist.data?.joined
    ? (cities.data?.items.find((c) => c.id === waitlist.data.cityId) ?? null)
    : null;
  const opened = waitingFor && waitingFor.launchStatus !== 'waitlist' ? waitingFor : null;
  const stillWaiting =
    waitlist.data?.joined === true &&
    (waitlist.data.cityId === null || (waitingFor !== null && !opened));
  // Waiting for a city already: show where you stand, unless you came back to pick another.
  if (!change && stillWaiting && !me.data?.cityId) return <Redirect href="/waitlisted" />;
  // Your city just opened: it's picked for you.
  const current = selected.length > 0 || other !== null ? selected : opened ? [opened.id] : [];

  const chosen = cities.data?.items.find((c) => c.id === current[0]) ?? null;
  const waitlisted = chosen?.launchStatus === 'waitlist';

  let content;
  if (cities.isPending) content = <LoadingState />;
  else if (cities.isError)
    content = (
      <ErrorState
        message={errorMessage(t, cities.error) ?? undefined}
        onRetry={() => void cities.refetch()}
      />
    );
  else {
    const options = cities.data.items.map((c) => ({
      id: c.id,
      label: c.launchStatus === 'waitlist' ? `${c.name} · ${t('onboarding.cityWaitlist')}` : c.name,
    }));
    content = (
      <>
        <ChipGroup
          label={t('onboarding.cityTitle')}
          mode="single"
          options={options}
          selected={current}
          onChange={(ids) => {
            setSelected(ids);
            setOther(null);
          }}
          testIDPrefix="city"
        />
        {other === null ? (
          <Button
            label={t('onboarding.cityMissing')}
            variant="ghost"
            onPress={() => {
              setOther('');
              setSelected([]);
            }}
            testID="city-missing"
          />
        ) : (
          <TextField
            label={t('onboarding.cityMissingLabel')}
            value={other}
            onChangeText={setOther}
            autoCapitalize="words"
            maxLength={60}
            testID="city-other"
          />
        )}
      </>
    );
  }

  const otherName = other?.trim() ?? '';
  return (
    <OnboardingStep
      step="city"
      title={t('onboarding.cityTitle')}
      primaryLabel={waitlisted || other !== null ? t('onboarding.joinWaitlist') : undefined}
      primaryDisabled={other !== null ? otherName.length < 2 : current.length === 0}
      loading={update.isPending || join.isPending}
      error={errorMessage(t, update.error ?? join.error)}
      onPrimary={() => {
        const [cityId] = current;
        if (other !== null) {
          void join.mutateAsync({ cityName: otherName }).then(
            () => {
              router.replace('/waitlisted');
            },
            () => undefined,
          );
        } else if (cityId && waitlisted) {
          void join.mutateAsync({ cityId }).then(
            () => {
              router.replace('/waitlisted');
            },
            () => undefined,
          );
        } else if (cityId) {
          void update.mutateAsync({ cityId }).then(next, () => undefined);
        }
      }}
    >
      {content}
    </OnboardingStep>
  );
}
