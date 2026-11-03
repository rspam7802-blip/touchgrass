import { CreateHostApplicationBody } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Screen, Text, TextField } from '../../../components/ui';
import { useApplyToHost } from '../../../src/features/payments/api';
import { errorMessage } from '../../../src/lib/errors';

/** Application to host paid plans (F-HST-01). */
export default function HostApplyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const apply = useApplyToHost();
  const [form, setForm] = useState({ about: '', experience: '', eventIdeas: '', link: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const set = (k: keyof typeof form, v: string): void => {
    setForm((f) => ({ ...f, [k]: v }));
  };
  const submit = async (): Promise<void> => {
    setFormError(null);
    const parsed = CreateHostApplicationBody.safeParse({
      about: form.about,
      experience: form.experience,
      eventIdeas: form.eventIdeas,
      links: form.link.trim() ? [form.link.trim()] : [],
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    try {
      await apply.mutateAsync(parsed.data);
      router.back();
    } catch (err) {
      setFormError(errorMessage(t, err));
    }
  };
  return (
    <Screen testID="host-apply-screen">
      <Text variant="title" accessibilityRole="header">
        {t('hosting.applyTitle')}
      </Text>
      <Text tone="muted">{t('hosting.applyBody')}</Text>
      {(['about', 'experience', 'eventIdeas'] as const).map((k) => (
        <TextField
          key={k}
          label={t(`hosting.${k}`)}
          value={form[k]}
          onChangeText={(v) => {
            set(k, v);
          }}
          multiline
          maxLength={1000}
          error={errors[k] ?? null}
          testID={`host-${k}`}
        />
      ))}
      <TextField
        label={t('hosting.links')}
        value={form.link}
        onChangeText={(v) => {
          set('link', v);
        }}
        autoCapitalize="none"
        keyboardType="url"
        error={errors.links ?? null}
        testID="host-link"
      />
      {formError ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="host-apply-error">
          {formError}
        </Text>
      ) : null}
      <Button
        label={t('hosting.submit')}
        loading={apply.isPending}
        onPress={() => void submit()}
        testID="host-submit"
      />
    </Screen>
  );
}
