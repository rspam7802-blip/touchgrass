import { ProfileVisibility } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../../components/ChipGroup';
import { ErrorState, LoadingState, Screen, SwitchRow, Text } from '../../../components/ui';
import { usePrivacy, useUpdatePrivacy } from '../../../src/features/me/api';
import { errorMessage } from '../../../src/lib/errors';

export default function PrivacySettingsScreen() {
  const { t } = useTranslation();
  const privacy = usePrivacy();
  const update = useUpdatePrivacy();
  if (privacy.isPending) {
    return (
      <Screen testID="privacy-settings">
        <LoadingState />
      </Screen>
    );
  }
  if (privacy.isError) {
    return (
      <Screen testID="privacy-settings">
        <ErrorState
          message={errorMessage(t, privacy.error) ?? undefined}
          onRetry={() => void privacy.refetch()}
        />
      </Screen>
    );
  }
  const p = privacy.data;
  return (
    <Screen testID="privacy-settings">
      <Text variant="heading">{t('settings.profileVisibility')}</Text>
      <ChipGroup
        label={t('settings.profileVisibility')}
        mode="single"
        options={ProfileVisibility.options.map((v) => ({
          id: v,
          label: t(`settings.visibility.${v}`),
        }))}
        selected={[p.profileVisibility]}
        onChange={([v]) => {
          const parsed = ProfileVisibility.safeParse(v);
          if (parsed.success) update.mutate({ profileVisibility: parsed.data });
        }}
        testIDPrefix="visibility"
      />
      <SwitchRow
        label={t('settings.showFirstTimer')}
        value={p.showFirstTimerBadge}
        onChange={(v) => {
          update.mutate({ showFirstTimerBadge: v });
        }}
        testID="toggle-first-timer"
      />
      <SwitchRow
        label={t('settings.readReceipts')}
        value={p.readReceipts}
        onChange={(v) => {
          update.mutate({ readReceipts: v });
        }}
        testID="toggle-read-receipts"
      />
      <SwitchRow
        label={t('settings.showInWhoIsGoing')}
        value={p.showInWhoIsGoing}
        onChange={(v) => {
          update.mutate({ showInWhoIsGoing: v });
        }}
        testID="toggle-who-is-going"
      />
      <SwitchRow
        label={t('settings.shareActivity')}
        value={p.shareActivity}
        onChange={(v) => {
          update.mutate({ shareActivity: v });
        }}
        testID="toggle-share-activity"
      />
      <SwitchRow
        label={t('settings.discoverableByContacts')}
        value={p.discoverableByContacts}
        onChange={(v) => {
          update.mutate({ discoverableByContacts: v });
        }}
        testID="toggle-discoverable"
      />
      {update.error ? (
        <Text tone="danger" accessibilityRole="alert">
          {errorMessage(t, update.error)}
        </Text>
      ) : null}
    </Screen>
  );
}
