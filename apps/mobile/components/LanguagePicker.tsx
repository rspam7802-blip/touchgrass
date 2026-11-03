import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@touchgrass/shared';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '../src/stores/settings-store';
import { Button } from './ui/Button';
import { Text } from './ui/Text';

/** English / తెలుగు / हिन्दी switcher (F-A11Y-03). Persists the choice on device. */
export function LanguagePicker() {
  const { t, i18n } = useTranslation();
  const setLanguage = useSettingsStore((s) => s.setLanguage);
  const current = i18n.language as SupportedLanguage;
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('settings.language')}
      accessibilityHint={t('a11y.languageHint')}
      style={styles.row}
    >
      <Text variant="label" tone="muted">
        {t('settings.language')}
      </Text>
      <View style={styles.options}>
        {SUPPORTED_LANGUAGES.map((code) => (
          <Button
            key={code}
            label={t(`settings.languageNames.${code}`)}
            variant={code === current ? 'primary' : 'ghost'}
            selected={code === current}
            accessibilityRole="radio"
            accessibilityHint={t('a11y.languageHint')}
            onPress={() => {
              void setLanguage(code);
            }}
            testID={`language-${code}`}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 8 },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
