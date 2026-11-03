import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share } from 'react-native';
import { PersonRow } from '../../../../components/PersonRow';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../../../components/ui';
import {
  useEvent,
  useInvite,
  useInviteLink,
  useInvitees,
} from '../../../../src/features/events/api';
import { errorMessage } from '../../../../src/lib/errors';

/** Invite your squad (F-EVT-04) or share an invite link that records you as the inviter. */
export default function InviteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const event = useEvent(id);
  const invitees = useInvitees(id);
  const invite = useInvite(id);
  const link = useInviteLink(id);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  if (invitees.isPending) return <LoadingState />;
  if (invitees.isError)
    return (
      <ErrorState
        message={errorMessage(t, invitees.error) ?? undefined}
        onRetry={() => void invitees.refetch()}
      />
    );
  const q = search.trim().toLowerCase();
  const people = invitees.data.items.filter((p) => p.person.displayName.toLowerCase().includes(q));

  return (
    <Screen testID="invite-screen">
      <Text variant="title" accessibilityRole="header">
        {t('events.inviteTitle')}
      </Text>
      <Button
        label={t('events.shareLink')}
        variant="secondary"
        loading={link.isPending}
        testID="share-invite-link"
        onPress={() => {
          link.mutateAsync().then(
            (l) =>
              void Share.share({
                message: t('events.shareMessage', { title: event.data?.title ?? '', url: l.url }),
              }),
            (err: unknown) => {
              setMessage(errorMessage(t, err));
            },
          );
        }}
      />
      <TextField
        label={t('events.inviteSearch')}
        value={search}
        onChangeText={setSearch}
        testID="invite-search"
      />
      {people.length === 0 ? <EmptyState body={t('squad.empty')} /> : null}
      {people.map((p) => {
        const done = p.invited || p.rsvp === 'going' || p.rsvp === 'checked_in';
        return (
          <PersonRow
            key={p.person.id}
            person={p.person}
            detail={done ? t('events.invited') : null}
            onOpen={() => {
              router.push({ pathname: '/users/[id]', params: { id: p.person.id } });
            }}
            actions={
              done ? null : (
                <Chip
                  label={t('events.invite')}
                  selected={selected.includes(p.person.id)}
                  testID={`invitee-${p.person.id}`}
                  onToggle={() => {
                    setSelected((s) =>
                      s.includes(p.person.id)
                        ? s.filter((x) => x !== p.person.id)
                        : [...s, p.person.id],
                    );
                  }}
                />
              )
            }
          />
        );
      })}
      {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
      <Button
        label={t('events.inviteSelected', { count: selected.length })}
        disabled={selected.length === 0}
        loading={invite.isPending}
        testID="send-invites"
        onPress={() => {
          invite.mutateAsync(selected).then(
            (r) => {
              setSelected([]);
              setMessage(t('events.invitesSent', { count: r.invited }));
              void invitees.refetch();
            },
            (err: unknown) => {
              setMessage(errorMessage(t, err));
            },
          );
        }}
      />
    </Screen>
  );
}
