import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EventTogetherTools } from '../../../../components/at-event/EventTogetherTools';
import { EventComments } from '../../../../components/EventComments';
import { EventDetailView } from '../../../../components/EventDetailView';
import { ErrorState, LoadingState, OfflineState, Screen, Text } from '../../../../components/ui';
import { useEvent } from '../../../../src/features/events/api';
import { useIsOffline } from '../../../../src/hooks/use-is-offline';
import { errorMessage } from '../../../../src/lib/errors';

/** Notices another screen can hand over when it opens this plan (only these keys are shown). */
const NOTICES = {
  inviteFailed: 'events.inviteFailedNotice',
  creditUsed: 'referrals.creditUsed',
} as const;

export default function EventScreen() {
  const { id, notice } = useLocalSearchParams<{ id: string; notice?: string }>();
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
        <>
          {notice && notice in NOTICES ? (
            <Text tone="primary" accessibilityLiveRegion="polite" testID="event-notice">
              {t(NOTICES[notice as keyof typeof NOTICES])}
            </Text>
          ) : null}
          <EventDetailView event={q.data} afterRsvp={<EventTogetherTools event={q.data} />} />
          <EventComments eventId={q.data.id} />
        </>
      )}
    </Screen>
  );
}
