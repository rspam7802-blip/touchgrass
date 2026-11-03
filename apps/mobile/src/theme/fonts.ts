import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';

/**
 * The brand typeface (D-145: Inter). To try another family, swap these imports for another
 * `@expo-google-fonts/*` package and update the five names below; nothing else changes.
 */
export const FONT_FILES = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
};

/**
 * Custom fonts on iOS and Android are one family per weight, so a `fontWeight` alone would fall back to the
 * system font. Maps a weight to the matching family.
 */
export function fontFamilyFor(weight: string | number | undefined): keyof typeof FONT_FILES {
  const w = Number(weight ?? 400);
  if (w >= 800) return 'Inter_800ExtraBold';
  if (w >= 700) return 'Inter_700Bold';
  if (w >= 600) return 'Inter_600SemiBold';
  if (w >= 500) return 'Inter_500Medium';
  return 'Inter_400Regular';
}
