import { motion } from '@touchgrass/shared';
import { type ReactNode, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  type GestureResponderEvent,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../../src/theme/theme';

/**
 * Motion for the app (D-154). Built on React Native's `Animated` with the native driver: smooth on the UI
 * thread, works in Expo Go and in tests, no extra native module. Every helper turns itself off when the
 * phone's Reduce Motion setting is on (`theme.reduceMotion`): things simply appear in their final state.
 */

const easeOut = Easing.out((t: number) => Easing.cubic(t));
const easeInOut = Easing.inOut((t: number) => Easing.quad(t));

/** A Pressable whose style can hold animated values (springy press feedback). */
export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type PressHandler = ((e: GestureResponderEvent) => void) | null | undefined;

/** Press feedback: shrinks a little while held and springs back on release. */
export function usePressScale(
  to = 0.96,
  handlers: { onPressIn?: PressHandler; onPressOut?: PressHandler } = {},
) {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const spring = (value: number): void => {
    if (theme.reduceMotion) return;
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 40,
      bounciness: value === 1 ? 8 : 0,
    }).start();
  };
  return {
    scaleStyle: { transform: [{ scale }] },
    onPressIn: (e: GestureResponderEvent) => {
      spring(to);
      handlers.onPressIn?.(e);
    },
    onPressOut: (e: GestureResponderEvent) => {
      spring(1);
      handlers.onPressOut?.(e);
    },
  };
}

/** Fades and rises into place when it first appears (lists stagger it with `delay`). */
export function FadeIn({
  children,
  delay = 0,
  distance = 12,
  style,
  testID,
}: {
  children: ReactNode;
  delay?: number;
  distance?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const theme = useTheme();
  const progress = useRef(new Animated.Value(theme.reduceMotion ? 1 : 0)).current;
  useEffect(() => {
    if (theme.reduceMotion) {
      progress.setValue(1);
      return undefined;
    }
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: motion.normal + 100,
      delay,
      easing: easeOut,
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [progress, delay, theme.reduceMotion]);
  return (
    <Animated.View
      testID={testID}
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** Stagger for list items: the first few cascade in, later ones (scrolled to) appear without waiting. */
export function staggerDelay(index: number, step = 60, max = 6): number {
  return index < max ? index * step : 0;
}

/** A quick "pop" (grow and settle) whenever `trigger` changes: likes, pulling up, ping sent. */
export function Pop({
  trigger,
  when = true,
  children,
  style,
}: {
  trigger: unknown;
  /** Only pop on changes where this is true (e.g. a tab becoming selected, not deselected). */
  when?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (theme.reduceMotion || !when) return;
    scale.setValue(0.8);
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 14,
      bounciness: 14,
    }).start();
    // Only a change of `trigger` replays the pop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);
  return <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>;
}

/** A soft breathing loop for "live" things (Free now, the Plot button glow). Still with Reduce Motion. */
export function Pulse({
  children,
  style,
  min = 0.55,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  min?: number;
}) {
  const theme = useTheme();
  const value = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (theme.reduceMotion) {
      value.setValue(1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: min,
          duration: motion.signalPulse / 2,
          easing: easeInOut,
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 1,
          duration: motion.signalPulse / 2,
          easing: easeInOut,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [value, min, theme.reduceMotion]);
  return <Animated.View style={[style, { opacity: value }]}>{children}</Animated.View>;
}

/** Placeholder block that gently shimmers while content loads (instead of a lone spinner). */
export function Skeleton({ style }: { style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <Pulse min={0.45}>
      <Animated.View
        style={[{ backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md }, style]}
      />
    </Pulse>
  );
}
