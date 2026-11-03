import {
  DEFAULT_LANGUAGE,
  resources,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
  type Translation,
} from '@touchgrass/shared';

export function isSupportedLanguage(value: string | undefined | null): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value ?? '');
}

/** Picks the best language from an explicit choice, then Accept-Language, then English. */
export function resolveLanguage(
  explicit: string | undefined | null,
  acceptLanguage: string | null,
): SupportedLanguage {
  if (isSupportedLanguage(explicit)) return explicit;
  const preferred = (acceptLanguage ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', q] = part.trim().split(';q=');
      return { lang: tag.toLowerCase().split('-')[0] ?? '', q: q ? Number(q) : 1 };
    })
    .sort((a, b) => b.q - a.q);
  return (
    (preferred.find((p) => isSupportedLanguage(p.lang))?.lang as SupportedLanguage | undefined) ??
    DEFAULT_LANGUAGE
  );
}

export function strings(language: SupportedLanguage): Translation {
  return resources[language];
}
