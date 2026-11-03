import type { ActivityItem } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PersonRow } from '../../../components/PersonRow';
import { SegmentedTabs } from '../../../components/SegmentedTabs';
import { SquadActions } from '../../../components/SquadActions';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  Screen,
  Text,
} from '../../../components/ui';
import { useIsOffline } from '../../../src/hooks/use-is-offline';
import {
  flatten,
  useActivity,
  useRequests,
  useSquad,
  useSquadAction,
  useSuggestions,
} from '../../../src/features/social/api';
import { errorMessage } from '../../../src/lib/errors';

type Section = 'squad' | 'requests' | 'suggestions' | 'activity';

function QueryState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const offline = useIsOffline();
  return offline ? (
    <OfflineState onRetry={onRetry} />
  ) : (
    <ErrorState message={errorMessage(t, error) ?? undefined} onRetry={onRetry} />
  );
}

export function activityText(
  t: (k: string, o?: Record<string, string>) => string,
  item: ActivityItem,
): string {
  return t(`activity.${item.verb}`, {
    actor: item.actor.displayName,
    subject: item.subject?.displayName ?? '',
    object: item.object?.title ?? '',
  });
}

/** Squad hub (F-SOC-02..04): squad, requests, people you might know, and what the squad is up to. */
export default function SquadScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [section, setSection] = useState<Section>('squad');
  const squad = useSquad();
  const requests = useRequests();
  const suggestions = useSuggestions();
  const activity = useActivity();
  const dismiss = useSquadAction();
  const open = (id: string): void => {
    router.push({ pathname: '/users/[id]', params: { id } });
  };
  // The empty squad state already offers "find friends", so the shortcut is not duplicated.
  const squadIsEmpty = section === 'squad' && squad.isSuccess && flatten(squad.data).length === 0;
  const incoming = requests.data?.items.filter((r) => r.direction === 'incoming').length ?? 0;
  const fmt = new Intl.DateTimeFormat(`${i18n.language}-IN`, {
    dateStyle: 'medium',
    timeZone: 'Asia/Kolkata',
  });

  let body;
  if (section === 'squad') {
    if (squad.isPending) body = <LoadingState />;
    else if (squad.isError)
      body = <QueryState error={squad.error} onRetry={() => void squad.refetch()} />;
    else {
      const people = flatten(squad.data);
      body =
        people.length === 0 ? (
          <EmptyState
            body={t('squad.empty')}
            actionLabel={t('squad.findContacts')}
            onAction={() => {
              router.push('/contacts');
            }}
          />
        ) : (
          <>
            {people.map((p) => (
              <PersonRow
                key={p.id}
                person={p}
                onOpen={() => {
                  open(p.id);
                }}
              />
            ))}
            {squad.hasNextPage ? (
              <Button
                label={t('common.seeAll')}
                variant="ghost"
                loading={squad.isFetchingNextPage}
                onPress={() => void squad.fetchNextPage()}
              />
            ) : null}
          </>
        );
    }
  } else if (section === 'requests') {
    if (requests.isPending) body = <LoadingState />;
    else if (requests.isError)
      body = <QueryState error={requests.error} onRetry={() => void requests.refetch()} />;
    else if (requests.data.items.length === 0)
      body = <EmptyState body={t('squad.requestsEmpty')} />;
    else
      body = requests.data.items.map((r) => (
        <PersonRow
          key={r.person.id}
          person={r.person}
          detail={r.direction === 'incoming' ? t('squad.incoming') : t('squad.outgoing')}
          onOpen={() => {
            open(r.person.id);
          }}
          actions={
            <SquadActions
              userId={r.person.id}
              relationship={r.direction === 'incoming' ? 'request_received' : 'request_sent'}
              compact
            />
          }
        />
      ));
  } else if (section === 'suggestions') {
    if (suggestions.isPending) body = <LoadingState />;
    else if (suggestions.isError)
      body = <QueryState error={suggestions.error} onRetry={() => void suggestions.refetch()} />;
    else if (suggestions.data.items.length === 0)
      body = <EmptyState body={t('squad.suggestionsEmpty')} />;
    else
      body = suggestions.data.items.map((s) => (
        <PersonRow
          key={s.person.id}
          person={s.person}
          detail={s.reasons.map((r) => t(`squad.reasons.${r}`)).join(' · ')}
          onOpen={() => {
            open(s.person.id);
          }}
          actions={
            <>
              <SquadActions userId={s.person.id} relationship="none" compact />
              <Button
                label={t('squad.dismiss')}
                variant="ghost"
                onPress={() => {
                  dismiss.mutate({ action: 'dismiss', userId: s.person.id });
                }}
                testID={`dismiss-${s.person.id}`}
              />
            </>
          }
        />
      ));
  } else {
    if (activity.isPending) body = <LoadingState />;
    else if (activity.isError)
      body = <QueryState error={activity.error} onRetry={() => void activity.refetch()} />;
    else {
      const items = flatten(activity.data);
      body =
        items.length === 0 ? (
          <EmptyState body={t('squad.activityEmpty')} />
        ) : (
          <>
            {items.map((item) => (
              <PersonRow
                key={item.id}
                person={item.actor}
                detail={`${activityText(t, item)} · ${fmt.format(new Date(item.createdAt))}`}
                onOpen={() => {
                  open(item.actor.id);
                }}
              />
            ))}
            {activity.hasNextPage ? (
              <Button
                label={t('common.seeAll')}
                variant="ghost"
                loading={activity.isFetchingNextPage}
                onPress={() => void activity.fetchNextPage()}
              />
            ) : null}
          </>
        );
    }
  }

  return (
    <Screen testID="squad-screen">
      <Text variant="title">{t('squad.title')}</Text>
      <Button
        label={t('crews.title')}
        variant="secondary"
        onPress={() => {
          router.push('/crews');
        }}
        testID="open-crews"
      />
      <SegmentedTabs<Section>
        value={section}
        onChange={setSection}
        tabs={[
          { key: 'squad', label: t('squad.tabSquad') },
          { key: 'requests', label: t('squad.tabRequests'), badge: incoming },
          { key: 'suggestions', label: t('squad.tabSuggestions') },
          { key: 'activity', label: t('squad.tabActivity') },
        ]}
      />
      {squadIsEmpty ? null : (
        <Button
          label={t('squad.findContacts')}
          variant="secondary"
          onPress={() => {
            router.push('/contacts');
          }}
          testID="open-contacts"
        />
      )}
      {body}
    </Screen>
  );
}
