import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button, Screen, Text } from '../../components/ui';
import { useTutorial } from '../../src/features/me/api';
import { useTheme } from '../../src/theme/theme';

export const TUTORIAL_CARDS = [
  { key: 'pullUp', emoji: '🙋' },
  { key: 'plot', emoji: '🗺️' },
  { key: 'squad', emoji: '👯' },
  { key: 'safety', emoji: '🛡️' },
] as const;

/** Skippable, replayable (Settings → Replay tutorial) intro to pulling up, plotting, squads and safety (F-ACC-04). */
export default function TutorialScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const tutorial = useTutorial();
  const [index, setIndex] = useState(0);
  const card = TUTORIAL_CARDS[index] ?? TUTORIAL_CARDS[0];
  const last = index === TUTORIAL_CARDS.length - 1;

  const finish = (): void => {
    void tutorial.mutateAsync(true).then(
      () => {
        router.replace('/profile');
      },
      () => {
        router.replace('/profile');
      },
    );
  };

  return (
    <Screen testID="tutorial-screen">
      <Text variant="label" tone="primary">
        {t('tutorial.title')}
      </Text>
      <View
        accessible
        accessibilityLabel={`${t(`tutorial.${card.key}Title`)}. ${t(`tutorial.${card.key}Body`)}`}
        accessibilityHint={t('tutorial.progress', {
          current: index + 1,
          total: TUTORIAL_CARDS.length,
        })}
        style={[
          styles.card,
          {
            backgroundColor: theme.colors.surfaceAlt,
            borderRadius: theme.radii.lg,
            padding: theme.spacing.xl,
          },
        ]}
        testID={`tutorial-card-${card.key}`}
      >
        <Text style={styles.emoji} importantForAccessibility="no">
          {card.emoji}
        </Text>
        <Text variant="title">{t(`tutorial.${card.key}Title`)}</Text>
        <Text>{t(`tutorial.${card.key}Body`)}</Text>
      </View>
      <Text variant="caption" tone="muted">
        {t('tutorial.progress', { current: index + 1, total: TUTORIAL_CARDS.length })}
      </Text>
      <Button
        label={last ? t('tutorial.done') : t('tutorial.next')}
        onPress={
          last
            ? finish
            : () => {
                setIndex((i) => i + 1);
              }
        }
        loading={tutorial.isPending}
        testID="tutorial-next"
      />
      {!last ? (
        <Button
          label={t('tutorial.skip')}
          variant="ghost"
          onPress={finish}
          testID="tutorial-skip"
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, minHeight: 240, justifyContent: 'center' },
  emoji: { fontSize: 56, lineHeight: 64 },
});
