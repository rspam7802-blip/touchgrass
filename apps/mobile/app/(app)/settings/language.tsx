import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguagePicker } from '../../../components/LanguagePicker';
import { Screen, Text } from '../../../components/ui';
import { useSaveLanguage } from '../../../src/features/me/api';
import { useSettingsStore } from '../../../src/stores/settings-store';

/** Device language switches instantly; the account language (used for push copy) follows. */
export default function LanguageSettingsScreen() {
  const { t } = useTranslation();
  const language = useSettingsStore((s) => s.language);
  const save = useSaveLanguage();
  const { mutate } = save;
  useEffect(() => {
    if (language) mutate(language);
  }, [language, mutate]);
  return (
    <Screen testID="language-settings">
      <Text variant="title">{t('settings.languageTitle')}</Text>
      <LanguagePicker />
    </Screen>
  );
}
