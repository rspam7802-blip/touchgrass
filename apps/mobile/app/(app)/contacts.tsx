import { useMutation } from '@tanstack/react-query';
import type { ContactMatch } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Share } from 'react-native';
import { useTranslation } from 'react-i18next';
import { PersonRow } from '../../components/PersonRow';
import { SquadActions } from '../../components/SquadActions';
import { Button, EmptyState, ListRow, Screen, Text } from '../../components/ui';
import { readAppEnvironment } from '../../src/config';
import { useMyInvites } from '../../src/features/me/api';
import { useMatchContacts } from '../../src/features/social/api';
import { type LocalContact, readHashedContacts } from '../../src/features/social/contacts';
import { inviteUrl } from '../../src/features/social/invite-link';
import { errorMessage } from '../../src/lib/errors';

/** Friends from contacts (F-SOC-01): hashed matching, add matches, invite everyone else via WhatsApp/SMS. */
export default function ContactsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const match = useMatchContacts();
  const invites = useMyInvites();
  const [denied, setDenied] = useState(false);
  const [local, setLocal] = useState<LocalContact[] | null>(null);
  const [matches, setMatches] = useState<ContactMatch[]>([]);

  const scan = useMutation({
    mutationFn: async () => {
      const read = await readHashedContacts();
      if (!read.granted) {
        setDenied(true);
        return;
      }
      setDenied(false);
      setLocal(read.contacts);
      if (read.contacts.length > 0)
        setMatches((await match.mutateAsync(read.contacts.map((c) => c.hash))).items);
    },
  });

  const matchedHashes = new Set(matches.map((m) => m.hash));
  const others = (local ?? []).filter((c) => !matchedHashes.has(c.hash));
  const invite = (c: LocalContact): void => {
    void Share.share({
      message: t('squad.inviteMessage', {
        url: inviteUrl(invites.data, readAppEnvironment().webUrl),
      }),
      title: c.name,
    });
  };

  return (
    <Screen testID="contacts-screen">
      <Text variant="title">{t('squad.contactsTitle')}</Text>
      <Text tone="muted">{t('squad.contactsBody')}</Text>
      <Button
        label={t('squad.scanContacts')}
        onPress={() => {
          scan.mutate();
        }}
        loading={scan.isPending}
        testID="scan-contacts"
      />
      {denied ? (
        <Text tone="danger" accessibilityRole="alert">
          {t('squad.contactsPermissionDenied')}
        </Text>
      ) : null}
      {scan.error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, scan.error)}
        </Text>
      ) : null}
      {local !== null ? (
        <>
          <Text variant="heading">{t('squad.onTouchGrass')}</Text>
          {matches.length === 0 ? (
            <EmptyState body={t('squad.noMatches')} />
          ) : (
            matches.map((m) => (
              <PersonRow
                key={m.hash}
                person={m.person}
                detail={local.find((c) => c.hash === m.hash)?.name ?? null}
                onOpen={() => {
                  router.push({ pathname: '/users/[id]', params: { id: m.person.id } });
                }}
                actions={
                  <SquadActions userId={m.person.id} relationship={m.relationship} compact />
                }
              />
            ))
          )}
          {others.length > 0 ? <Text variant="heading">{t('squad.inviteContacts')}</Text> : null}
          {others.slice(0, 200).map((c) => (
            <ListRow
              key={c.hash}
              label={c.name}
              detail={t('squad.invite')}
              onPress={() => {
                invite(c);
              }}
              testID={`invite-${c.hash.slice(0, 8)}`}
            />
          ))}
        </>
      ) : null}
    </Screen>
  );
}
