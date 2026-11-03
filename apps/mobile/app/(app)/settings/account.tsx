import { useMutation } from '@tanstack/react-query';
import { LIMITS } from '@touchgrass/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Screen, Text, TextField } from '../../../components/ui';
import { useDeleteAccount, useExportData } from '../../../src/features/me/api';
import { shareExport } from '../../../src/features/me/export';
import { errorMessage } from '../../../src/lib/errors';

/** Data export and account deletion (DPDP Act 2023, F-ACC-07). */
export default function AccountSettingsScreen() {
  const { t } = useTranslation();
  const exportData = useExportData();
  const del = useDeleteAccount();
  const [confirm, setConfirm] = useState('');
  const share = useMutation({
    mutationFn: async () => shareExport(await exportData.mutateAsync()),
  });
  return (
    <Screen testID="account-settings">
      <Text variant="heading">{t('settings.exportData')}</Text>
      <Button
        label={t('settings.exportData')}
        variant="secondary"
        onPress={() => {
          share.mutate();
        }}
        loading={share.isPending}
        testID="export-data"
      />
      {share.isSuccess ? <Text tone="primary">{t('settings.exportReady')}</Text> : null}
      {share.error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, share.error)}
        </Text>
      ) : null}
      <Text variant="heading">{t('settings.deleteAccount')}</Text>
      <Text tone="muted">
        {t('settings.deleteWarning', { days: LIMITS.account.deletionGraceDays })}
      </Text>
      <TextField
        label={t('settings.deleteConfirmLabel')}
        value={confirm}
        onChangeText={setConfirm}
        autoCapitalize="characters"
        autoCorrect={false}
        testID="delete-confirm"
      />
      <Button
        label={t('settings.deleteConfirm')}
        variant="danger"
        disabled={confirm !== 'DELETE'}
        loading={del.isPending}
        onPress={() => {
          del.mutate();
        }}
        testID="delete-account"
      />
      {del.error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, del.error)}
        </Text>
      ) : null}
    </Screen>
  );
}
