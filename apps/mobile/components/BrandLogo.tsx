import { BRAND } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';
import LOGO from '../assets/brand/logo.png';

/**
 * The company logo (D-152): the pixel grass on lime, without the wordmark. Labelled with the brand name, unless the
 * name is written right next to it (`decorative`). Pixel art, so it is scaled without smoothing.
 */
export function BrandLogo({ size, decorative = false }: { size: number; decorative?: boolean }) {
  return decorative ? (
    <Image
      source={LOGO}
      style={[styles.logo, { width: size, height: size }]}
      contentFit="contain"
      accessibilityIgnoresInvertColors
      accessible={false}
      importantForAccessibility="no"
      testID="brand-logo"
    />
  ) : (
    <Image
      source={LOGO}
      style={[styles.logo, { width: size, height: size }]}
      contentFit="contain"
      accessibilityIgnoresInvertColors
      accessibilityLabel={BRAND.name}
      accessibilityRole="image"
      testID="brand-logo"
    />
  );
}

const styles = StyleSheet.create({ logo: { borderRadius: 0 } });
