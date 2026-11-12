import { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useTheme } from '../src/theme/theme';
import { BrandLogo, LOGO_LIME } from './BrandLogo';

const HOLD_MS = 450;
const FADE_MS = 280;

/**
 * Shown over the app for a moment at launch (D-177): the same lime as the system splash, so the hand-over is
 * seamless, with the grass growing in before the screen underneath is revealed. Skipped with Reduce Motion.
 */
export function LaunchAnimation() {
  const theme = useTheme();
  const [done, setDone] = useState(theme.reduceMotion);
  const opacity = useRef(new Animated.Value(1)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (done) return null;
  return (
    <Animated.View
      style={[styles.cover, { backgroundColor: LOGO_LIME, opacity }]}
      pointerEvents="none"
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      testID="launch-animation"
    >
      <BrandLogo
        size={168}
        decorative
        onGrown={() => {
          timer.current = setTimeout(() => {
            Animated.timing(opacity, {
              toValue: 0,
              duration: FADE_MS,
              useNativeDriver: true,
            }).start(() => {
              setDone(true);
            });
          }, HOLD_MS);
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
