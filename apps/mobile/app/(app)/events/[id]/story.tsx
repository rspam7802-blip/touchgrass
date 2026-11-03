import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StoryCard, type StoryCardRef } from '../../../../components/StoryCard';
import { Button, ErrorState, LoadingState, Screen, Text } from '../../../../components/ui';
import { useTrack } from '../../../../src/features/analytics/analytics';
import { useEvent } from '../../../../src/features/events/api';
import { formatWhen, locationLabel } from '../../../../src/features/events/format';
import { shareStory } from '../../../../src/features/share/share';
import { errorMessage } from '../../../../src/lib/errors';

/** A plan as a 9:16 story card (F-GRW-02), mystery-safe: it shows what this viewer may see. */
export default function EventStoryScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useEvent(id);
  const card = useRef<StoryCardRef>(null);
  const track = useTrack();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const e = q.data;
  const share = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      track('share_tapped', { target: 'event_story' });
      await shareStory(card);
    } catch {
      setError(t('states.errorBody'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen testID="event-story-screen">
      <StoryCard
        ref={card}
        title={e.title}
        lines={[formatWhen(e.startsAt, i18n.language, e.timezone), locationLabel(t, e.location)]}
        footer={e.shareUrl.replace(/^https?:\/\//, '')}
        testID="event-story-card"
      />
      <Button
        label={t('share.shareStory')}
        loading={busy}
        onPress={() => void share()}
        testID="event-story-share"
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
