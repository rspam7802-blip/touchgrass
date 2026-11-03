import type { ChallengeView } from '@touchgrass/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../components/ui';
import { localized } from '../../src/features/catalog/api';
import { useChallenges, useCrews, useJoinChallenge } from '../../src/features/engagement/api';
import { formatWhen } from '../../src/features/events/format';
import { errorMessage } from '../../src/lib/errors';
import { useTheme } from '../../src/theme/theme';

/** Themed challenges (F-GAM-03): join solo or with a crew, see progress and the reward. */
export default function ChallengesScreen() {
  const { t } = useTranslation();
  const q = useChallenges();
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  return (
    <Screen testID="challenges-screen">
      {q.data.items.length === 0 ? <EmptyState title={t('challenges.empty')} /> : null}
      {q.data.items.map((c) => (
        <ChallengeCard key={c.id} c={c} />
      ))}
    </Screen>
  );
}

function ChallengeCard({ c }: { c: ChallengeView }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const join = useJoinChallenge();
  const crews = useCrews('mine');
  const [error, setError] = useState<string | null>(null);
  const myCrews = (crews.data?.items ?? []).filter((x) => x.viewer.status === 'active');
  const go = async (crewId: string | null): Promise<void> => {
    setError(null);
    try {
      await join.mutateAsync({ id: c.id, crewId });
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  const title = localized(c.title, i18n.language);
  return (
    <View
      style={[styles.card, { borderColor: theme.colors.border, borderRadius: theme.radii.md }]}
      testID={`challenge-${c.id}`}
    >
      <Text variant="heading" accessibilityRole="header">
        {c.emoji} {title}
      </Text>
      <Text>{localized(c.description, i18n.language)}</Text>
      <Text variant="caption" tone="muted">
        {[
          c.mode === 'group' ? t('challenges.group') : t('challenges.solo'),
          c.state === 'upcoming'
            ? t('challenges.startsOn', { date: formatWhen(c.startsAt, i18n.language) })
            : c.state === 'active'
              ? t('challenges.endsOn', { date: formatWhen(c.endsAt, i18n.language) })
              : t('challenges.ended'),
        ].join(' · ')}
      </Text>
      {c.rewardBadge ? (
        <Text variant="caption">
          {t('challenges.reward', {
            emoji: c.rewardBadge.emoji,
            name: localized(c.rewardBadge.name, i18n.language),
          })}
        </Text>
      ) : null}
      {c.joined ? (
        <>
          {c.team ? (
            <Text variant="caption">{t('challenges.team', { crew: c.team.crewName })}</Text>
          ) : null}
          <View
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t('challenges.progress', { current: c.progress, target: c.target })}
            accessibilityValue={{ min: 0, max: c.target, now: c.progress }}
            style={[styles.track, { backgroundColor: theme.colors.surfaceAlt }]}
          >
            <View
              style={[
                styles.fill,
                {
                  width: `${Math.round((c.progress / c.target) * 100)}%`,
                  backgroundColor: theme.colors.primary,
                },
              ]}
            />
          </View>
          <Text testID={`challenge-progress-${c.id}`}>
            {c.completedAt
              ? t('challenges.completed')
              : t('challenges.progress', { current: c.progress, target: c.target })}
          </Text>
        </>
      ) : c.state !== 'ended' ? (
        c.mode === 'solo' ? (
          <Button
            label={t('challenges.join')}
            loading={join.isPending}
            onPress={() => void go(null)}
            testID={`join-${c.id}`}
          />
        ) : (
          <>
            {myCrews.length === 0 ? (
              <Text tone="muted">{t('events.reasons.NEEDS_CREW')}</Text>
            ) : (
              <Text variant="label">{t('challenges.pickCrew')}</Text>
            )}
            {myCrews.map((crew) => (
              <Button
                key={crew.id}
                label={t('challenges.joinWithCrew', { crew: crew.name })}
                variant="secondary"
                onPress={() => void go(crew.id)}
                testID={`join-${c.id}-${crew.id}`}
              />
            ))}
          </>
        )
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, padding: 16, gap: 8 },
  track: { height: 10, borderRadius: 5, overflow: 'hidden' },
  fill: { height: 10 },
});
