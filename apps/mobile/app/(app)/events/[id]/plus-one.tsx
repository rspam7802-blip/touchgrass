import { genderOnly } from '@touchgrass/shared';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share } from 'react-native';
import { PersonRow } from '../../../../components/PersonRow';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
} from '../../../../components/ui';
import { useEvent, useRsvp } from '../../../../src/features/events/api';
import { flatten, useSquad } from '../../../../src/features/social/api';
import { errorMessage } from '../../../../src/lib/errors';

/** Bring a +1 (F-EVT-07): a squad member, or a friend not on TouchGrass who gets a claim link. */
export default function PlusOneScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const event = useEvent(id);
  const squad = useSquad();
  const rsvp = useRsvp(id);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  if (squad.isPending || event.isPending) return <LoadingState />;
  if (squad.isError)
    return (
      <ErrorState
        message={errorMessage(t, squad.error) ?? undefined}
        onRetry={() => void squad.refetch()}
      />
    );
  if (event.isError)
    return (
      <ErrorState
        message={errorMessage(t, event.error) ?? undefined}
        onRetry={() => void event.refetch()}
      />
    );

  // Already holding a seat? Changing the +1 means pulling up again, so the API asks to cancel first.
  const bring = async (plusOne: { userId: string } | { guest: true }): Promise<void> => {
    setError(null);
    try {
      const res = await rsvp.mutateAsync({ status: 'going', plusOne });
      if (res && 'plusOneClaimUrl' in res && res.plusOneClaimUrl) {
        setDone(res.plusOneClaimUrl);
        await Share.share({ message: t('events.plusOneShare', { url: res.plusOneClaimUrl }) });
      } else setDone('');
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const people = flatten(squad.data);
  return (
    <Screen testID="plus-one-screen">
      <Text variant="title" accessibilityRole="header">
        {t('events.plusOneLabel')}
      </Text>
      <Text tone="muted">{event.data.title}</Text>
      {genderOnly(event.data.visibility) === null ? (
        <Button
          label={t('events.plusOneGuest')}
          variant="secondary"
          loading={rsvp.isPending}
          onPress={() => void bring({ guest: true })}
          testID="plus-one-guest"
        />
      ) : null}
      {people.length === 0 ? <EmptyState body={t('squad.empty')} /> : null}
      {people.map((p) => (
        <PersonRow
          key={p.id}
          person={p}
          onOpen={() => void bring({ userId: p.id })}
          actions={
            <Button
              label={t('events.bring')}
              variant="secondary"
              onPress={() => void bring({ userId: p.id })}
            />
          }
        />
      ))}
      {done !== null ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID="plus-one-done">
          {done ? t('events.plusOneShare', { url: done }) : t('events.youreGoing')}
        </Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="plus-one-error">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
