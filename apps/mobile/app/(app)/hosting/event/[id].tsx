import { useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ErrorState, LoadingState, Screen, Text } from '../../../../components/ui';
import { formatWhen } from '../../../../src/features/events/format';
import { useEventAnalytics } from '../../../../src/features/payments/api';
import { errorMessage } from '../../../../src/lib/errors';
import { StatGrid } from '../../../../components/hosting/StatGrid';

/** Insights for one plan (F-HST-02). */
export default function EventInsightsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const q = useEventAnalytics(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const a = q.data;
  return (
    <Screen testID="event-insights">
      <Text variant="title" accessibilityRole="header">
        {a.title}
      </Text>
      <Text tone="muted">{formatWhen(a.startsAt, i18n.language)}</Text>
      <StatGrid a={a} language={i18n.language} />
      <Text variant="heading" accessibilityRole="header">
        {t('hosting.themes')}
      </Text>
      {a.themes.length === 0 ? (
        <Text tone="muted">{t('hosting.noRatings')}</Text>
      ) : (
        a.themes.map((th) => (
          <Text key={th.theme}>
            {th.theme} · {th.count}
          </Text>
        ))
      )}
    </Screen>
  );
}
