import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EventCard } from '../../../components/EventCard';
import { SegmentedTabs } from '../../../components/SegmentedTabs';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  Screen,
  Text,
} from '../../../components/ui';
import { type MyEventsScope, useMyEvents } from '../../../src/features/events/api';
import { flatten } from '../../../src/features/social/api';
import { useIsOffline } from '../../../src/hooks/use-is-offline';
import { errorMessage } from '../../../src/lib/errors';

/** Your plans (F-EVT-06): upcoming, hosting and past, with the Plot CTA (F-EVT-01). */
export default function PlansScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const offline = useIsOffline();
  const [scope, setScope] = useState<MyEventsScope>('upcoming');
  const q = useMyEvents(scope);

  let body;
  if (q.isPending) body = <LoadingState />;
  else if (q.isError)
    body = offline ? (
      <OfflineState onRetry={() => void q.refetch()} />
    ) : (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  else {
    const items = flatten(q.data);
    body =
      items.length === 0 ? (
        <EmptyState body={t('events.empty')} />
      ) : (
        <>
          {items.map((e) => (
            <EventCard
              key={e.id}
              event={e}
              onOpen={() => {
                router.push({ pathname: '/events/[id]', params: { id: e.id } });
              }}
            />
          ))}
          {q.hasNextPage ? (
            <Button
              label={t('common.seeAll')}
              variant="ghost"
              loading={q.isFetchingNextPage}
              onPress={() => void q.fetchNextPage()}
            />
          ) : null}
        </>
      );
  }

  return (
    <Screen testID="plans-screen">
      <Text variant="title" accessibilityRole="header">
        {t('events.title')}
      </Text>
      <Button
        label={t('events.plot')}
        testID="plot-cta"
        onPress={() => {
          router.push('/plot');
        }}
      />
      <Button
        label={t('proposals.list')}
        variant="secondary"
        testID="open-proposals"
        onPress={() => {
          router.push('/proposals');
        }}
      />
      <SegmentedTabs
        tabs={[
          { key: 'upcoming', label: t('events.upcoming') },
          { key: 'hosting', label: t('events.hosting') },
          { key: 'past', label: t('events.past') },
        ]}
        value={scope}
        onChange={setScope}
      />
      {body}
    </Screen>
  );
}
