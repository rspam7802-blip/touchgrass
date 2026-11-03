import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EventTogetherTools } from '../../../../components/at-event/EventTogetherTools';
import { EventDetailView } from '../../../../components/EventDetailView';
import { ErrorState, LoadingState, OfflineState, Screen } from '../../../../components/ui';
import { useEvent } from '../../../../src/features/events/api';
import { useIsOffline } from '../../../../src/hooks/use-is-offline';
import { errorMessage } from '../../../../src/lib/errors';

export default function EventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const offline = useIsOffline();
  const q = useEvent(id);
  return (
    <Screen testID="event-screen">
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        offline ? (
          <OfflineState onRetry={() => void q.refetch()} />
        ) : (
          <ErrorState
            message={errorMessage(t, q.error) ?? undefined}
            onRetry={() => void q.refetch()}
          />
        )
      ) : (
        <EventDetailView event={q.data} afterRsvp={<EventTogetherTools event={q.data} />} />
      )}
    </Screen>
  );
}
