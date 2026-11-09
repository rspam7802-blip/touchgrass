import { normalizeE164 } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { Button, Screen, Text, TextField } from '../../components/ui';
import { useRequestOtp } from '../../src/features/auth/api';
import { openLegal } from '../../src/features/legal/links';
import { errorMessage } from '../../src/lib/errors';
import { useAuthFlowStore } from '../../src/stores/auth-flow-store';

export default function PhoneScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestOtp = useRequestOtp();

  const submit = async (): Promise<void> => {
    const e164 = normalizeE164(phone);
    if (!e164) {
      setError(t('auth.invalidPhone'));
      return;
    }
    try {
      await requestOtp.mutateAsync(e164);
      useAuthFlowStore.getState().setPhone(e164);
      router.push('/otp');
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <Screen testID="phone-screen">
      <Text variant="title">{t('auth.phoneTitle')}</Text>
      <Text tone="muted">{t('auth.phoneBody')}</Text>
      <TextField
        label={t('auth.phoneLabel')}
        hint={t('auth.phoneHint')}
        value={phone}
        onChangeText={(v) => {
          setPhone(v);
          setError(null);
        }}
        keyboardType="phone-pad"
        autoComplete="tel"
        textContentType="telephoneNumber"
        error={error}
        testID="phone-input"
      />
      <Button
        label={t('auth.sendCode')}
        onPress={() => void submit()}
        loading={requestOtp.isPending}
        disabled={phone.replace(/\D/g, '').length < 10}
        testID="phone-submit"
      />
      <Text variant="caption" tone="muted">
        {t('auth.termsNotice')}
      </Text>
      <View style={styles.legal}>
        <Button
          label={t('settings.terms')}
          variant="ghost"
          accessibilityRole="link"
          onPress={() => {
            openLegal('terms');
          }}
          testID="open-terms"
        />
        <Button
          label={t('settings.privacyPolicy')}
          variant="ghost"
          accessibilityRole="link"
          onPress={() => {
            openLegal('privacy');
          }}
          testID="open-privacy"
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  legal: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
