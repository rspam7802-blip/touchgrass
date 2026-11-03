import { type CrewJoinPolicy, CreateCrewBody, LIMITS } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../../components/ChipGroup';
import { Button, Screen, Text, TextField } from '../../../components/ui';
import { localized, useInterests } from '../../../src/features/catalog/api';
import { useCreateCrew } from '../../../src/features/engagement/api';
import { errorMessage } from '../../../src/lib/errors';

/** Start a crew (F-ENG-02): name, what it does, who can join. */
export default function NewCrewScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const interests = useInterests();
  const create = useCreateCrew();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [interestId, setInterestId] = useState<string | null>(null);
  const [policy, setPolicy] = useState<CrewJoinPolicy>('request');
  const [error, setError] = useState<string | null>(null);
  const parsed = CreateCrewBody.safeParse({ name, description, interestId, joinPolicy: policy });
  const save = async (): Promise<void> => {
    if (!parsed.success) return;
    setError(null);
    try {
      const crew = await create.mutateAsync(parsed.data);
      router.replace({ pathname: '/crews/[id]', params: { id: crew.id } });
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  return (
    <Screen testID="crew-new">
      <TextField
        label={t('crews.name')}
        value={name}
        onChangeText={setName}
        maxLength={LIMITS.crews.nameMaxLength}
        testID="crew-name"
      />
      <TextField
        label={t('crews.description')}
        value={description}
        onChangeText={setDescription}
        maxLength={LIMITS.crews.descriptionMaxLength}
        multiline
        testID="crew-description"
      />
      <ChipGroup
        label={t('events.category')}
        mode="single"
        options={(interests.data?.items ?? []).map((i) => ({
          id: i.id,
          label: localized(i.name, i18n.language),
        }))}
        selected={interestId ? [interestId] : []}
        onChange={(next) => {
          setInterestId(next[0] ?? null);
        }}
        testIDPrefix="crew-interest"
      />
      <ChipGroup
        label={t('crews.joinPolicy')}
        mode="single"
        options={[
          { id: 'request', label: t('crews.policyRequest') },
          { id: 'invite_only', label: t('crews.policyInvite') },
        ]}
        selected={[policy]}
        onChange={(next) => {
          if (next[0] === 'request' || next[0] === 'invite_only') setPolicy(next[0]);
        }}
        testIDPrefix="crew-policy"
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('crews.create')}
        disabled={!parsed.success}
        loading={create.isPending}
        onPress={() => void save()}
        testID="crew-save"
      />
    </Screen>
  );
}
