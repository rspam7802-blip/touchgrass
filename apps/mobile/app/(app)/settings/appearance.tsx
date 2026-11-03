import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../../components/ChipGroup';
import { Screen, Text } from '../../../components/ui';
import { type Appearance, useSettingsStore } from '../../../src/stores/settings-store';

const OPTIONS: Appearance[] = ['system', 'light', 'dark'];

/** Light or dark (D-153): follows the phone by default; the choice is stored on this device only. */
export default function AppearanceSettingsScreen() {
  const { t } = useTranslation();
  const appearance = useSettingsStore((s) => s.appearance);
  const setAppearance = useSettingsStore((s) => s.setAppearance);
  return (
    <Screen testID="appearance-settings">
      <Text variant="title">{t('settings.appearance')}</Text>
      <Text tone="muted">{t('settings.appearanceHint')}</Text>
      <ChipGroup
        label={t('settings.appearance')}
        mode="single"
        options={OPTIONS.map((o) => ({ id: o, label: t(`settings.appearanceOptions.${o}`) }))}
        selected={[appearance]}
        onChange={(next) => {
          const value = OPTIONS.find((o) => o === next[0]);
          if (value) void setAppearance(value);
        }}
        testIDPrefix="appearance"
      />
    </Screen>
  );
}
