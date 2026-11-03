import {
  DEFAULT_LANGUAGE,
  localeTag,
  resources,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@touchgrass/shared';
import { getLocales } from 'expo-localization';
import i18next, { type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';

/** Picks the first device locale we support (te-IN → te), else English. */
export function detectDeviceLanguage(): SupportedLanguage {
  for (const locale of getLocales()) {
    const code = locale.languageCode ?? '';
    if ((SUPPORTED_LANGUAGES as readonly string[]).includes(code)) return code as SupportedLanguage;
  }
  return DEFAULT_LANGUAGE;
}

function supported(lng: string | undefined): SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(lng ?? '')
    ? (lng as SupportedLanguage)
    : DEFAULT_LANGUAGE;
}

export function createI18n(language: SupportedLanguage): I18n {
  const instance = i18next.createInstance();
  void instance.use(initReactI18next).init({
    resources: Object.fromEntries(
      SUPPORTED_LANGUAGES.map((l) => [l, { translation: resources[l] }]),
    ),
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false },
    returnNull: false,
    initAsync: false,
  });
  // Day and month in IST in the reader's locale ("14 Nov"), for dates inside reason copy such as a cooldown's end.
  instance.services.formatter?.add('istDate', (value: unknown, lng: string | undefined) =>
    value instanceof Date
      ? new Intl.DateTimeFormat(localeTag(supported(lng)), {
          day: 'numeric',
          month: 'short',
          timeZone: 'Asia/Kolkata',
        }).format(value)
      : String(value),
  );
  return instance;
}

export { localeTag };
