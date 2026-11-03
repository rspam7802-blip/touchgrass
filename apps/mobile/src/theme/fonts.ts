import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

/** Plus Jakarta Sans, the brand typeface. Loaded at launch (root layout) before the splash screen hides. */
export const FONT_FILES = {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
};

/**
 * Custom fonts on iOS and Android are one family per weight, so a `fontWeight` alone would fall back to the
 * system font. Maps a weight to the matching family.
 */
export function fontFamilyFor(weight: string | number | undefined): keyof typeof FONT_FILES {
  const w = Number(weight ?? 400);
  if (w >= 800) return 'PlusJakartaSans_800ExtraBold';
  if (w >= 700) return 'PlusJakartaSans_700Bold';
  if (w >= 600) return 'PlusJakartaSans_600SemiBold';
  if (w >= 500) return 'PlusJakartaSans_500Medium';
  return 'PlusJakartaSans_400Regular';
}
