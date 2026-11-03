import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { EmptyState, ErrorState, ListRow, LoadingState, Screen } from '../../../components/ui';
import { recapTitle } from '../../../components/engagement/RecapCard';
import { useRecaps } from '../../../src/features/engagement/api';
import { errorMessage } from '../../../src/lib/errors';

/** Monthly and yearly recaps (F-GAM-04). */
export default function RecapsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const q = useRecaps();
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  return (
    <Screen testID="recaps-screen">
      {q.data.items.length === 0 ? <EmptyState title={t('recap.empty')} /> : null}
      {q.data.items.map((r) => (
        <ListRow
          key={r.id}
          label={recapTitle(t, r, i18n.language)}
          detail={`${String(r.stats.eventsAttended)} ${t('recap.eventsAttended')}`}
          onPress={() => {
            router.push({ pathname: '/recaps/[id]', params: { id: r.id } });
          }}
          testID={`recap-${r.id}`}
        />
      ))}
    </Screen>
  );
}
