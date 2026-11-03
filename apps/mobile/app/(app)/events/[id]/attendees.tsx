import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PersonRow } from '../../../../components/PersonRow';
import { SegmentedTabs } from '../../../../components/SegmentedTabs';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
} from '../../../../components/ui';
import { useAttendees, useEvent, useHosts } from '../../../../src/features/events/api';
import { errorMessage } from '../../../../src/lib/errors';

/**
 * Who's pulling up (F-EVT-06). Hosts also see first-timers to welcome (F-EVT-13 newcomer list) and can make people
 * co-hosts or welcome hosts (F-EVT-13).
 */
export default function AttendeesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const event = useEvent(id);
  const q = useAttendees(id);
  const hosts = useHosts(id);
  const [tab, setTab] = useState<'all' | 'new'>('all');
  const [error, setError] = useState<string | null>(null);
  if (q.isPending || event.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  if (event.isError)
    return (
      <ErrorState
        message={errorMessage(t, event.error) ?? undefined}
        onRetry={() => void event.refetch()}
      />
    );
  const isPrimaryHost = event.data.viewer.hostRole === 'host';
  const isHost = event.data.viewer.isHost;
  const items = tab === 'new' ? q.data.items.filter((a) => a.firstTime) : q.data.items;
  const run = (input: Parameters<typeof hosts.mutateAsync>[0]): void => {
    setError(null);
    hosts.mutateAsync(input).then(
      () => void q.refetch(),
      (err: unknown) => {
        setError(errorMessage(t, err));
      },
    );
  };

  return (
    <Screen testID="attendees-screen">
      <Text variant="title" accessibilityRole="header">
        {t('events.whoIsGoing')}
      </Text>
      {isHost ? (
        <SegmentedTabs
          tabs={[
            { key: 'all', label: t('events.everyone') },
            {
              key: 'new',
              label: t('events.newcomers'),
              badge: q.data.items.filter((a) => a.firstTime).length,
            },
          ]}
          value={tab}
          onChange={setTab}
        />
      ) : null}
      {items.length === 0 ? <EmptyState body={t('events.nobodyYet')} /> : null}
      {items.map((a) => {
        const detail = [
          a.isHost ? t('events.hosts') : null,
          a.firstTime ? t('events.firstTime') : null,
          // Hosts only (the API sends null to everyone else): helps plan for no-shows (F-SAF-02).
          a.reliabilityTier ? t(`profile.tiers.${a.reliabilityTier}`) : null,
          a.status === 'checked_in'
            ? t('events.checkedIn')
            : a.status === 'waitlisted'
              ? t('events.waitlisted')
              : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const hostRole = event.data.hosts.find((h) => h.person.id === a.person.id)?.role ?? null;
        return (
          <PersonRow
            key={a.person.id}
            person={a.person}
            detail={detail || null}
            onOpen={() => {
              router.push({ pathname: '/users/[id]', params: { id: a.person.id } });
            }}
            actions={
              isPrimaryHost && hostRole !== 'host' && a.status !== 'waitlisted' ? (
                hostRole ? (
                  <Button
                    label={t('events.removeHost')}
                    variant="ghost"
                    onPress={() => {
                      run({ action: 'remove', userId: a.person.id });
                    }}
                  />
                ) : (
                  <>
                    <Button
                      label={t('events.addCohost')}
                      variant="secondary"
                      onPress={() => {
                        run({ action: 'add', userId: a.person.id, role: 'co_host' });
                      }}
                    />
                    <Button
                      label={t('events.addWelcomeHost')}
                      variant="secondary"
                      onPress={() => {
                        run({ action: 'add', userId: a.person.id, role: 'welcome_host' });
                      }}
                    />
                  </>
                )
              ) : null
            }
          />
        );
      })}
      {q.data.hiddenCount > 0 ? (
        <Text tone="muted">{t('events.hiddenAttendees', { count: q.data.hiddenCount })}</Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      ) : null}
    </Screen>
  );
}
