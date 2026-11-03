import type { CrewListQuery } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SegmentedTabs } from '../../../components/SegmentedTabs';
import {
  Button,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
} from '../../../components/ui';
import { useCrews } from '../../../src/features/engagement/api';
import { formatWhen } from '../../../src/features/events/format';
import { errorMessage } from '../../../src/lib/errors';

/** Crews (F-ENG-02): yours (including invites and requests) and open crews in your city. */
export default function CrewsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [scope, setScope] = useState<CrewListQuery['scope']>('mine');
  const q = useCrews(scope);
  return (
    <Screen testID="crews-screen">
      <SegmentedTabs<CrewListQuery['scope']>
        tabs={[
          { key: 'mine', label: t('crews.mine') },
          { key: 'discover', label: t('crews.discover') },
        ]}
        value={scope}
        onChange={setScope}
      />
      <Button
        label={t('crews.create')}
        variant="secondary"
        onPress={() => {
          router.push('/crews/new');
        }}
        testID="crew-create"
      />
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState
          message={errorMessage(t, q.error) ?? undefined}
          onRetry={() => void q.refetch()}
        />
      ) : q.data.items.length === 0 ? (
        <EmptyState title={scope === 'mine' ? t('crews.empty') : t('crews.discoverEmpty')} />
      ) : (
        q.data.items.map((c) => (
          <ListRow
            key={c.id}
            label={c.name}
            detail={[
              t('crews.members', { count: c.memberCount }),
              c.viewer.status === 'invited'
                ? t('crews.invited')
                : c.viewer.status === 'requested'
                  ? t('crews.requested')
                  : null,
              c.nextSession ? formatWhen(c.nextSession.startsAt, i18n.language) : null,
            ]
              .filter(Boolean)
              .join(' · ')}
            onPress={() => {
              router.push({ pathname: '/crews/[id]', params: { id: c.id } });
            }}
            testID={`crew-${c.id}`}
          />
        ))
      )}
    </Screen>
  );
}
