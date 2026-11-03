import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanResponder, StyleSheet, View } from 'react-native';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
} from '../../../../components/ui';
import { localized } from '../../../../src/features/catalog/api';
import { useDeck, usePushIcebreaker } from '../../../../src/features/chat/api';
import { useEvent } from '../../../../src/features/events/api';
import { errorMessage } from '../../../../src/lib/errors';
import { useTheme } from '../../../../src/theme/theme';

const SWIPE_DISTANCE = 60;

/**
 * Icebreaker deck (F-ATE-01): one prompt at a time, swipe or tap Next/Previous (screen readers swipe up/down on
 * the card). Hosts can put the current card on everyone's screen and in the plan's chat.
 */
export default function IcebreakersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const deck = useDeck(id);
  const event = useEvent(id);
  const push = usePushIcebreaker(id);
  const [index, setIndex] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const count = deck.data?.items.length ?? 0;
  const step = (delta: number): void => {
    if (count === 0) return;
    setNotice(null);
    setIndex((i) => (i + delta + count) % count);
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_e, g) => {
        if (g.dx <= -SWIPE_DISTANCE) stepRef.current(1);
        else if (g.dx >= SWIPE_DISTANCE) stepRef.current(-1);
      },
    }),
  ).current;

  if (deck.isPending) return <LoadingState />;
  if (deck.isError)
    return (
      <ErrorState
        message={errorMessage(t, deck.error) ?? undefined}
        onRetry={() => void deck.refetch()}
      />
    );
  const card = deck.data.items[index % Math.max(1, count)];
  if (!card) return <EmptyState title={t('ate.icebreakers')} />;
  const prompt = localized(card.prompt, i18n.language);
  const isHost = event.data?.viewer.isHost ?? false;

  return (
    <Screen testID="icebreakers-screen">
      <Text variant="title" accessibilityRole="header">
        {t('ate.icebreakers')}
      </Text>
      <Text tone="muted">{t('ate.icebreakerHint')}</Text>
      <View
        {...pan.panHandlers}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`${prompt}, ${String(index + 1)} / ${String(count)}`}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          step(e.nativeEvent.actionName === 'increment' ? 1 : -1);
        }}
        testID="icebreaker-card"
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surface,
            borderColor: theme.colors.primary,
            borderRadius: theme.radii.lg,
          },
        ]}
      >
        <Text variant="title" style={styles.prompt} testID="icebreaker-prompt">
          {prompt}
        </Text>
        <Text variant="caption" tone="muted">
          {String(index + 1)} / {String(count)}
        </Text>
      </View>
      <View style={styles.row}>
        <Button
          label={t('ate.prevCard')}
          variant="ghost"
          onPress={() => {
            step(-1);
          }}
          style={styles.grow}
          testID="prev-card"
        />
        <Button
          label={t('ate.nextCard')}
          onPress={() => {
            step(1);
          }}
          style={styles.grow}
          testID="next-card"
        />
      </View>
      {isHost ? (
        <Button
          label={t('ate.pushToAll')}
          variant="secondary"
          loading={push.isPending}
          onPress={() => {
            setError(null);
            push.mutateAsync(card.id).then(
              () => {
                setNotice(t('ate.pushed'));
              },
              (err: unknown) => {
                setError(errorMessage(t, err));
              },
            );
          }}
          testID="push-card"
        />
      ) : null}
      {notice ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID="push-notice">
          {notice}
        </Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="push-error">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 240,
    padding: 24,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  prompt: { textAlign: 'center' },
  row: { flexDirection: 'row', gap: 8 },
  grow: { flexGrow: 1 },
});
