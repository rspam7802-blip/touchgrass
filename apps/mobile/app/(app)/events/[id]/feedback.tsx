import type { FeedbackSummary } from '@touchgrass/shared';
import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { EmptyState, ErrorState, LoadingState, Screen, Text } from '../../../../components/ui';
import { useFeedbackSummary } from '../../../../src/features/after/api';
import { formatWhen } from '../../../../src/features/events/format';
import { errorMessage } from '../../../../src/lib/errors';
import { useTheme } from '../../../../src/theme/theme';

/**
 * Host view of a plan's feedback (F-AFT-02 / F-HST-02): averages, tag counts and anonymous comments.
 * Comments only appear once enough people answered that none can be traced back (the API enforces it).
 */
export default function FeedbackSummaryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const q = useFeedbackSummary(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const s = q.data;
  if (s.count === 0)
    return (
      <Screen testID="feedback-summary">
        <EmptyState title={t('after.noFeedback')} />
      </Screen>
    );
  return (
    <Screen testID="feedback-summary">
      <Text variant="title" accessibilityRole="header">
        {t('after.feedbackTitle')}
      </Text>
      <Text testID="feedback-count">{t('after.responses', { count: s.count })}</Text>
      {s.averageRating !== null ? (
        <Text variant="heading" testID="feedback-average">
          {t('after.average', { rating: s.averageRating.toFixed(1) })}
        </Text>
      ) : null}
      {s.hostAverage !== null ? (
        <Text testID="feedback-host-average">
          {t('after.hostAverage', { rating: s.hostAverage.toFixed(1) })}
        </Text>
      ) : null}
      <TagList title={t('after.whatWasGreat')} tags={s.great} ns="great" testID="great-tags" />
      <TagList
        title={t('after.whatCouldImprove')}
        tags={s.improve}
        ns="improve"
        testID="improve-tags"
      />
      {s.comments.length > 0 ? (
        <View style={styles.section} testID="feedback-comments">
          <Text variant="heading" accessibilityRole="header">
            {t('after.comments')}
          </Text>
          {s.comments.map((c, i) => (
            <View
              key={`${c.createdAt}-${String(i)}`}
              style={[
                styles.comment,
                { borderColor: theme.colors.border, borderRadius: theme.radii.md },
              ]}
              accessible
            >
              <Text>{c.comment}</Text>
              <Text variant="caption" tone="muted">
                {t('after.star', { count: c.rating })} · {formatWhen(c.createdAt, i18n.language)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function TagList({
  title,
  tags,
  ns,
  testID,
}: {
  title: string;
  tags: FeedbackSummary['great'];
  ns: 'great' | 'improve';
  testID: string;
}) {
  const { t } = useTranslation();
  if (tags.length === 0) return null;
  return (
    <View style={styles.section} testID={testID}>
      <Text variant="heading" accessibilityRole="header">
        {title}
      </Text>
      {tags.map((tag) => (
        <Text key={tag.tag}>
          {t(`after.${ns}.${tag.tag}`, { defaultValue: tag.tag })} · {tag.count}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 6 },
  comment: { borderWidth: 1, padding: 12, gap: 4 },
});
