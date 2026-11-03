import { CreateProposalBody, LIMITS } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../../components/ChipGroup';
import { SquadPicker } from '../../../components/engagement/SquadPicker';
import { Button, Screen, SwitchRow, Text, TextField } from '../../../components/ui';
import { localized, useInterests } from '../../../src/features/catalog/api';
import { useCreateProposal } from '../../../src/features/engagement/api';
import { errorMessage } from '../../../src/lib/errors';

const DEADLINES = [2, 6, 24, 48] as const;

/** Start a vote (F-ENG-03): the idea, who's in, when voting closes; suggestions come next. */
export default function NewProposalScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const interests = useInterests();
  const create = useCreateProposal();
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [invitees, setInvitees] = useState<string[]>([]);
  const [hours, setHours] = useState<number>(24);
  const [autoLock, setAutoLock] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const parsed = CreateProposalBody.safeParse({
    title,
    categoryInterestId: category,
    inviteeIds: invitees,
    deadline: new Date(Date.now() + hours * 3_600_000).toISOString(),
    autoLock,
  });
  const save = async (): Promise<void> => {
    if (!parsed.success) return;
    setError(null);
    try {
      const p = await create.mutateAsync(parsed.data);
      router.replace({ pathname: '/proposals/[id]', params: { id: p.id } });
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  return (
    <Screen testID="proposal-new">
      <TextField
        label={t('proposals.titleLabel')}
        value={title}
        onChangeText={setTitle}
        maxLength={LIMITS.proposals.titleMaxLength}
        testID="proposal-title"
      />
      <ChipGroup
        label={t('events.categoryLabel')}
        mode="single"
        options={(interests.data?.items ?? []).map((i) => ({
          id: i.id,
          label: localized(i.name, i18n.language),
        }))}
        selected={category ? [category] : []}
        onChange={(next) => {
          setCategory(next[0] ?? null);
        }}
        testIDPrefix="proposal-category"
      />
      <SquadPicker
        label={t('proposals.invitees')}
        selected={invitees}
        onChange={setInvitees}
        max={LIMITS.proposals.maxInvitees}
      />
      <ChipGroup
        label={t('proposals.deadline')}
        mode="single"
        options={DEADLINES.map((h) => ({
          id: String(h),
          label: t('proposals.deadlineHours', { count: h }),
        }))}
        selected={[String(hours)]}
        onChange={(next) => {
          const h = Number(next[0]);
          if (Number.isFinite(h)) setHours(h);
        }}
        testIDPrefix="proposal-deadline"
      />
      <SwitchRow
        label={t('proposals.autoLock')}
        value={autoLock}
        onChange={setAutoLock}
        testID="proposal-autolock"
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('proposals.create')}
        disabled={!parsed.success}
        loading={create.isPending}
        onPress={() => void save()}
        testID="proposal-save"
      />
    </Screen>
  );
}
