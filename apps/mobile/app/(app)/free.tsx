import { LIMITS } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../components/ChipGroup';
import { Button, Screen, Text, TextField } from '../../components/ui';
import { useSetFree } from '../../src/features/engagement/api';
import { errorMessage } from '../../src/lib/errors';

const HOURS = Array.from(
  { length: LIMITS.availability.maxHours - LIMITS.availability.minHours + 1 },
  (_, i) => LIMITS.availability.minHours + i,
);

/** "I'm free now" (F-ENG-01): for how long (1–6 h) and an optional note for the squad. */
export default function FreeScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const set = useSetFree();
  const [hours, setHours] = useState(2);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const save = async (): Promise<void> => {
    setError(null);
    try {
      await set.mutateAsync({ hours, note: note.trim() });
      router.back();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  return (
    <Screen testID="free-screen">
      <Text variant="title" accessibilityRole="header">
        {t('free.setTitle')}
      </Text>
      <ChipGroup
        label={t('free.howLong')}
        mode="single"
        options={HOURS.map((h) => ({ id: String(h), label: t('free.hours', { count: h }) }))}
        selected={[String(hours)]}
        onChange={(next) => {
          const h = Number(next[0]);
          if (Number.isFinite(h)) setHours(h);
        }}
        testIDPrefix="free-hours"
      />
      <TextField
        label={t('free.noteLabel')}
        placeholder={t('free.notePlaceholder')}
        value={note}
        onChangeText={setNote}
        maxLength={LIMITS.availability.noteMaxLength}
        testID="free-note"
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('free.set')}
        loading={set.isPending}
        onPress={() => void save()}
        testID="free-save"
      />
    </Screen>
  );
}
