import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
} from '../../../components/ui';
import { useProposals } from '../../../src/features/engagement/api';
import { formatWhen } from '../../../src/features/events/format';
import { errorMessage } from '../../../src/lib/errors';

/** Plans up for a vote (F-ENG-03). */
export default function ProposalsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const q = useProposals();
  return (
    <Screen testID="proposals-screen">
      <Button
        label={t('proposals.create')}
        onPress={() => {
          router.push('/proposals/new');
        }}
        testID="proposal-create"
      />
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState
          message={errorMessage(t, q.error) ?? undefined}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.items.length === 0 ? (
        <EmptyState title={t('proposals.empty')} />
      ) : (
        q.data.items.map((p) => (
          <ListRow
            key={p.id}
            label={p.title}
            detail={[
              p.creator.displayName,
              p.status === 'open'
                ? t('proposals.closes', { time: formatWhen(p.deadline, i18n.language) })
                : p.status === 'locked'
                  ? t('proposals.locked')
                  : t('proposals.cancelled'),
            ].join(' · ')}
            onPress={() => {
              router.push({ pathname: '/proposals/[id]', params: { id: p.id } });
            }}
            testID={`proposal-${p.id}`}
          />
        ))
      )}
    </Screen>
  );
}
