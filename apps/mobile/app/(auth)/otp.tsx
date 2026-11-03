import { LIMITS, maskPhone } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Screen, Text, TextField } from '../../components/ui';
import { useRequestOtp, useVerifyOtp } from '../../src/features/auth/api';
import { ApiError } from '../../src/lib/api-client';
import { errorMessage } from '../../src/lib/errors';
import { useAuthFlowStore } from '../../src/stores/auth-flow-store';

const RESEND_SECONDS = LIMITS.otp.resendAfterMs / 1000;

export default function OtpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const phone = useAuthFlowStore((s) => s.phone);
  const inviteCode = useAuthFlowStore((s) => s.inviteCode);
  const claimToken = useAuthFlowStore((s) => s.claimToken);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(RESEND_SECONDS);
  const verify = useVerifyOtp();
  const resend = useRequestOtp();

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => {
      setSecondsLeft((s) => s - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [secondsLeft]);

  if (!phone) {
    return (
      <Screen testID="otp-screen">
        <Button
          label={t('auth.changeNumber')}
          onPress={() => {
            router.replace('/phone');
          }}
        />
      </Screen>
    );
  }

  const submit = async (): Promise<void> => {
    try {
      await verify.mutateAsync({ phone, code, inviteCode, claimToken });
      useAuthFlowStore.getState().reset();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'INVITE_REQUIRED') {
        router.push({ pathname: '/invite', params: { next: 'otp' } });
        return;
      }
      setError(errorMessage(t, err));
    }
  };

  return (
    <Screen testID="otp-screen">
      <Text variant="title">{t('auth.otpTitle')}</Text>
      <Text tone="muted">{t('auth.otpBody', { phone: maskPhone(phone) })}</Text>
      <TextField
        label={t('auth.otpLabel')}
        value={code}
        onChangeText={(v) => {
          setCode(v.replace(/\D/g, '').slice(0, LIMITS.otp.length));
          setError(null);
        }}
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        maxLength={LIMITS.otp.length}
        error={error}
        testID="otp-input"
      />
      <Button
        label={t('auth.verify')}
        onPress={() => void submit()}
        loading={verify.isPending}
        disabled={code.length !== LIMITS.otp.length}
        testID="otp-submit"
      />
      <Button
        label={secondsLeft > 0 ? t('auth.resendIn', { seconds: secondsLeft }) : t('auth.resend')}
        variant="ghost"
        disabled={secondsLeft > 0 || resend.isPending}
        onPress={() => {
          void resend.mutateAsync(phone).then(
            () => {
              setSecondsLeft(RESEND_SECONDS);
            },
            (err: unknown) => {
              setError(errorMessage(t, err));
            },
          );
        }}
        testID="otp-resend"
      />
      <Button
        label={t('auth.changeNumber')}
        variant="ghost"
        onPress={() => {
          router.back();
        }}
      />
    </Screen>
  );
}
