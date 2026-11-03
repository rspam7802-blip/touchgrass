import { CreatePollBody } from '@touchgrass/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Screen, SwitchRow, Text, TextField } from '../../../../components/ui';
import { useCreatePoll } from '../../../../src/features/chat/api';
import { errorMessage } from '../../../../src/lib/errors';

/** Hosts ask the group (F-CHT-05): 2–10 options, single or multiple choice, optionally anonymous. */
export default function NewPollScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const create = useCreatePoll(id);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [multi, setMulti] = useState(false);
  const [anonymous, setAnonymous] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const parsed = CreatePollBody.safeParse({
      question,
      options: options.map((o) => o.trim()).filter(Boolean),
      multi,
      anonymous,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? null);
      return;
    }
    try {
      await create.mutateAsync(parsed.data);
      router.back();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <Screen testID="poll-screen">
      <Text variant="title" accessibilityRole="header">
        {t('chat.newPoll')}
      </Text>
      <TextField
        label={t('chat.pollQuestion')}
        value={question}
        onChangeText={setQuestion}
        maxLength={200}
        testID="poll-question"
      />
      {options.map((o, i) => (
        <TextField
          key={i}
          label={t('chat.pollOption', { n: i + 1 })}
          value={o}
          maxLength={80}
          onChangeText={(v) => {
            setOptions((list) => list.map((x, j) => (j === i ? v : x)));
          }}
          testID={`poll-option-input-${String(i)}`}
        />
      ))}
      {options.length < 10 ? (
        <Button
          label={t('chat.addOption')}
          variant="ghost"
          onPress={() => {
            setOptions((l) => [...l, '']);
          }}
          testID="add-option"
        />
      ) : null}
      <SwitchRow label={t('chat.pollMulti')} value={multi} onChange={setMulti} />
      <SwitchRow label={t('chat.pollAnonymous')} value={anonymous} onChange={setAnonymous} />
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="poll-error">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('chat.createPoll')}
        loading={create.isPending}
        onPress={() => void submit()}
        testID="create-poll"
      />
    </Screen>
  );
}
