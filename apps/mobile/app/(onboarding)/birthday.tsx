import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { OnboardingStep } from '../../components/OnboardingStep';
import { Text, TextField } from '../../components/ui';
import { useUpdateProfile } from '../../src/features/me/api';
import { composeDate } from '../../src/features/me/dob';
import { useStepNav } from '../../src/features/me/use-step-nav';
import { ApiError } from '../../src/lib/api-client';
import { errorMessage } from '../../src/lib/errors';
import { useAuthStore } from '../../src/stores/auth-store';

/** Age gate (F-ACC-03). The server blocks under-18s; the app then signs out. */
export default function BirthdayStep() {
  const { t } = useTranslation();
  const update = useUpdateProfile();
  const next = useStepNav('birthday');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  if (blocked) {
    return (
      <OnboardingStep
        step="birthday"
        title={t('errors.AGE_RESTRICTED')}
        primaryLabel={t('common.close')}
        onPrimary={() => void useAuthStore.getState().signOut()}
      >
        <Text tone="muted" accessibilityRole="alert">
          {t('errors.AGE_RESTRICTED')}
        </Text>
      </OnboardingStep>
    );
  }

  const submit = async (): Promise<void> => {
    const date = composeDate(day, month, year);
    if (!date) {
      setError(t('onboarding.invalidDate'));
      return;
    }
    try {
      await update.mutateAsync({ dateOfBirth: date });
      next();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'AGE_RESTRICTED') setBlocked(true);
      else setError(errorMessage(t, err));
    }
  };

  return (
    <OnboardingStep
      step="birthday"
      title={t('onboarding.dobTitle')}
      body={t('onboarding.dobBody')}
      primaryDisabled={!day || !month || year.length !== 4}
      loading={update.isPending}
      error={error}
      onPrimary={() => void submit()}
    >
      <View style={styles.row}>
        <View style={styles.cell}>
          <TextField
            label={t('onboarding.day')}
            value={day}
            onChangeText={(v) => {
              setDay(v.replace(/\D/g, '').slice(0, 2));
            }}
            keyboardType="number-pad"
            maxLength={2}
            testID="dob-day"
          />
        </View>
        <View style={styles.cell}>
          <TextField
            label={t('onboarding.month')}
            value={month}
            onChangeText={(v) => {
              setMonth(v.replace(/\D/g, '').slice(0, 2));
            }}
            keyboardType="number-pad"
            maxLength={2}
            testID="dob-month"
          />
        </View>
        <View style={styles.wide}>
          <TextField
            label={t('onboarding.year')}
            value={year}
            onChangeText={(v) => {
              setYear(v.replace(/\D/g, '').slice(0, 4));
            }}
            keyboardType="number-pad"
            maxLength={4}
            testID="dob-year"
          />
        </View>
      </View>
    </OnboardingStep>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexGrow: 1, minWidth: 80 },
  wide: { flexGrow: 2, minWidth: 110 },
});
