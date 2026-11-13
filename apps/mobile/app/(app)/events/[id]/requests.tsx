import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { PersonRow } from '../../../../components/PersonRow';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
} from '../../../../components/ui';
import { useDecideJoinRequest, useJoinRequests } from '../../../../src/features/events/api';
import { errorMessage } from '../../../../src/lib/errors';

/**
 * Private plans (D-179): the people asking to join, oldest first. A host opens a profile to see who they are,
 * then lets them in or not. Declining is final and is not announced to the person.
 */
export default function JoinRequestsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const q = useJoinRequests(id);
  const decide = useDecideJoinRequest(id);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const items = q.data.pages.flatMap((p) => p.items);
  const answer = (userId: string, approve: boolean): void => {
    setError(null);
    setBusy(userId);
    decide
      .mutateAsync({ userId, approve })
      .then(
        () => q.refetch(),
        (err: unknown) => {
          setError(errorMessage(t, err));
        },
      )
      .finally(() => {
        setBusy(null);
      });
  };

  return (
    <Screen testID="join-requests-screen">
      <Text variant="title" accessibilityRole="header">
        {t('events.joinRequestsTitle')}
      </Text>
      <Text tone="muted">{t('events.joinRequestsBody')}</Text>
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      {items.length === 0 ? <EmptyState body={t('events.joinRequestsEmpty')} /> : null}
      {items.map((r) => (
        <View key={r.person.id} style={styles.item} testID={`join-request-${r.person.id}`}>
          <PersonRow
            person={r.person}
            onOpen={() => {
              router.push({ pathname: '/users/[id]', params: { id: r.person.id } });
            }}
          />
          <View style={styles.actions}>
            <Button
              label={t('events.joinApprove')}
              loading={busy === r.person.id}
              disabled={busy !== null && busy !== r.person.id}
              onPress={() => {
                answer(r.person.id, true);
              }}
              style={styles.grow}
              testID={`join-approve-${r.person.id}`}
            />
            <Button
              label={t('events.joinDecline')}
              variant="secondary"
              disabled={busy !== null}
              onPress={() => {
                answer(r.person.id, false);
              }}
              style={styles.grow}
              testID={`join-decline-${r.person.id}`}
            />
          </View>
        </View>
      ))}
      {q.hasNextPage ? (
        <Button
          label={t('common.loadMore')}
          variant="ghost"
          loading={q.isFetchingNextPage}
          onPress={() => void q.fetchNextPage()}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  item: { gap: 8 },
  actions: { flexDirection: 'row', gap: 10 },
  grow: { flexGrow: 1, flexShrink: 1 },
});
