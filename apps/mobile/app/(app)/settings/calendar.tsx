import { useTranslation } from 'react-i18next';
import * as Linking from 'expo-linking';
import { Share } from 'react-native';
import { Button, ErrorState, LoadingState, Screen, Text } from '../../../components/ui';
import { useTrack } from '../../../src/features/analytics/analytics';
import { useCalendarFeed, useResetCalendarFeed } from '../../../src/features/notifications/api';
import { errorMessage } from '../../../src/lib/errors';

/** Private calendar feed (F-CAL-01): subscribe once in Google/Apple/Outlook; reset if the link leaks. */
export default function CalendarFeedScreen() {
  const { t } = useTranslation();
  const q = useCalendarFeed();
  const reset = useResetCalendarFeed();
  const track = useTrack();
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  return (
    <Screen testID="calendar-feed-screen">
      <Text>{t('calendar.subscribeBody')}</Text>
      <Button
        label={t('calendar.subscribe')}
        onPress={() => {
          track('calendar_subscribed', { target: 'feed' });
          void Linking.openURL(q.data.webcalUrl);
        }}
        testID="calendar-subscribe"
      />
      <Button
        label={t('calendar.copyLink')}
        variant="secondary"
        onPress={() => void Share.share({ message: q.data.url })}
        testID="calendar-share"
      />
      <Button
        label={t('calendar.resetLink')}
        variant="ghost"
        loading={reset.isPending}
        onPress={() => {
          reset.mutate();
        }}
        testID="calendar-reset"
      />
      {reset.isSuccess ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID="calendar-reset-done">
          {t('calendar.resetDone')}
        </Text>
      ) : null}
    </Screen>
  );
}
