import { BRAND } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import GRASS from '../assets/brand/grass.png';
import { useTheme } from '../src/theme/theme';

/** The logo's lime (the same colour as the app icon and splash). */
export const LOGO_LIME = '#E5FB46';

const GROW_MS = 700;
const SWAY_MS = 2600;
const SWAY_DEG = 2.5;
const easeSway = Easing.inOut((t: number) => Easing.sin(t));

/**
 * The company logo (D-152, D-177): the pixel grass on a lime tile, without the wordmark. The grass grows out
 * of the ground when it appears, then sways as if in a light breeze; with Reduce Motion on it stands still.
 * Labelled with the brand name, unless the name is written right next to it (`decorative`). Pixel art, so it
 * is scaled without smoothing.
 */
export function BrandLogo({
  size,
  decorative = false,
  onGrown,
}: {
  size: number;
  decorative?: boolean;
  /** Called once the grass has finished growing (at once with Reduce Motion). */
  onGrown?: () => void;
}) {
  const theme = useTheme();
  const still = theme.reduceMotion;
  const grow = useRef(new Animated.Value(still ? 1 : 0)).current;
  const sway = useRef(new Animated.Value(0)).current;
  const grown = useRef(onGrown);
  grown.current = onGrown;

  useEffect(() => {
    if (still) {
      grow.setValue(1);
      sway.setValue(0);
      grown.current?.();
      return undefined;
    }
    const growing = Animated.timing(grow, {
      toValue: 1,
      duration: GROW_MS,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    });
    const swaying = Animated.loop(
      Animated.sequence([
        Animated.timing(sway, {
          toValue: 1,
          duration: SWAY_MS / 2,
          easing: easeSway,
          useNativeDriver: true,
        }),
        Animated.timing(sway, {
          toValue: -1,
          duration: SWAY_MS,
          easing: easeSway,
          useNativeDriver: true,
        }),
        Animated.timing(sway, {
          toValue: 0,
          duration: SWAY_MS / 2,
          easing: easeSway,
          useNativeDriver: true,
        }),
      ]),
    );
    growing.start(({ finished }) => {
      if (!finished) return;
      grown.current?.();
      swaying.start();
    });
    return () => {
      growing.stop();
      swaying.stop();
    };
  }, [still, grow, sway]);

  const a11y = decorative
    ? ({ accessible: false, importantForAccessibility: 'no' } as const)
    : ({
        accessible: true,
        accessibilityLabel: BRAND.name,
        accessibilityRole: 'image',
      } as const);

  return (
    <View
      {...a11y}
      testID="brand-logo"
      style={[
        styles.tile,
        { width: size, height: size, borderRadius: size * 0.22, backgroundColor: LOGO_LIME },
      ]}
    >
      <Animated.View
        testID="brand-logo-grass"
        style={[
          styles.fill,
          {
            // Anchored at the ground line, so the blades grow upwards and bend from their roots.
            transformOrigin: '50% 82%',
            transform: [
              { scaleY: grow },
              {
                rotate: sway.interpolate({
                  inputRange: [-1, 1],
                  outputRange: [`-${String(SWAY_DEG)}deg`, `${String(SWAY_DEG)}deg`],
                }),
              },
            ],
          },
        ]}
      >
        <Image
          source={GRASS}
          style={styles.fill}
          contentFit="contain"
          accessibilityIgnoresInvertColors
          accessible={false}
          importantForAccessibility="no"
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { overflow: 'hidden' },
  fill: { width: '100%', height: '100%' },
});
