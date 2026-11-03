import { CreateHostAccountBody } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Screen, Text, TextField } from '../../../components/ui';
import { useCreateHostAccount } from '../../../src/features/payments/api';
import { errorMessage } from '../../../src/lib/errors';

/** Payout setup (F-PAY-03): creates the Razorpay Route account; Razorpay runs KYC. */
export default function HostAccountScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const create = useCreateHostAccount();
  const [form, setForm] = useState({ legalBusinessName: '', contactName: '', email: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const fields = [
    ['legalBusinessName', t('hosting.legalName')],
    ['contactName', t('hosting.contactName')],
    ['email', t('hosting.email')],
  ] as const;
  const submit = async (): Promise<void> => {
    setFormError(null);
    const parsed = CreateHostAccountBody.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      await create.mutateAsync(parsed.data);
      router.back();
    } catch (err) {
      setFormError(errorMessage(t, err));
    }
  };
  return (
    <Screen testID="host-account-screen">
      <Text variant="title" accessibilityRole="header">
        {t('hosting.payoutSetup')}
      </Text>
      <Text tone="muted">{t('hosting.payoutSetupBody')}</Text>
      {fields.map(([k, label]) => (
        <TextField
          key={k}
          label={label}
          value={form[k]}
          onChangeText={(v) => {
            setForm((f) => ({ ...f, [k]: v }));
          }}
          autoCapitalize={k === 'email' ? 'none' : 'words'}
          keyboardType={k === 'email' ? 'email-address' : 'default'}
          error={errors[k] ?? null}
          testID={`kyc-${k}`}
        />
      ))}
      {formError ? (
        <Text tone="danger" accessibilityLiveRegion="assertive">
          {formError}
        </Text>
      ) : null}
      <Button
        label={t('hosting.startKyc')}
        loading={create.isPending}
        onPress={() => void submit()}
        testID="kyc-submit"
      />
    </Screen>
  );
}
