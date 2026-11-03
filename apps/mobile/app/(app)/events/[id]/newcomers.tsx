import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PersonRow } from '../../../../components/PersonRow';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
} from '../../../../components/ui';
import { useNewcomers, useWelcome } from '../../../../src/features/chat/api';
import { errorMessage } from '../../../../src/lib/errors';

/** Hosts' first-timer checklist (F-ATE-03): everyone new gets a hello and an introduction. */
export default function NewcomersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const q = useNewcomers(id);
  const welcome = useWelcome(id);
  const [error, setError] = useState<string | null>(null);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  return (
    <Screen testID="newcomers-screen">
      <Text variant="title" accessibilityRole="header">
        {t('ate.newcomers')}
      </Text>
      <Text tone="muted">{t('ate.welcomeChecklist')}</Text>
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
      {q.data.items.length === 0 ? (
        <EmptyState title={t('ate.noNewcomers')} />
      ) : (
        q.data.items.map((n) => (
          <PersonRow
            key={n.person.id}
            person={n.person}
            detail={n.welcomedBy ? `${t('ate.welcomed')} · ${n.welcomedBy}` : null}
            onOpen={() => {
              router.push({ pathname: '/users/[id]', params: { id: n.person.id } });
            }}
            actions={
              <Button
                label={n.welcomed ? t('ate.welcomed') : t('ate.markWelcomed')}
                variant={n.welcomed ? 'ghost' : 'secondary'}
                selected={n.welcomed}
                accessibilityHint={t('a11y.toggleHint')}
                onPress={() => {
                  setError(null);
                  welcome
                    .mutateAsync({ userId: n.person.id, welcomed: !n.welcomed })
                    .catch((err: unknown) => {
                      setError(errorMessage(t, err));
                    });
                }}
                testID={`welcome-${n.person.id}`}
              />
            }
          />
        ))
      )}
    </Screen>
  );
}
