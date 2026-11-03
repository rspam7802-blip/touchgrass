import { LIMITS } from '@touchgrass/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SquadPicker } from '../../../../components/engagement/SquadPicker';
import { Button, Screen, Text } from '../../../../components/ui';
import { useCrew, useCrewInvite } from '../../../../src/features/engagement/api';
import { errorMessage } from '../../../../src/lib/errors';

/** Crew admins invite people from their squad (F-ENG-02). */
export default function CrewInviteScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const crew = useCrew(id);
  const invite = useCrewInvite(id);
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const exclude = [...(crew.data?.members ?? []), ...(crew.data?.requests ?? [])].map(
    (m) => m.person.id,
  );
  const send = async (): Promise<void> => {
    setNotice(null);
    try {
      await invite.mutateAsync(selected);
      setNotice(t('crews.inviteSent'));
      router.back();
    } catch (err) {
      setNotice(errorMessage(t, err));
    }
  };
  return (
    <Screen testID="crew-invite-screen">
      <SquadPicker
        label={t('crews.invite')}
        selected={selected}
        onChange={setSelected}
        exclude={exclude}
        max={LIMITS.crews.maxInviteBatch}
      />
      {notice ? <Text accessibilityLiveRegion="polite">{notice}</Text> : null}
      <Button
        label={t('crews.invite')}
        disabled={selected.length === 0}
        loading={invite.isPending}
        onPress={() => void send()}
        testID="crew-invite-send"
      />
    </Screen>
  );
}
