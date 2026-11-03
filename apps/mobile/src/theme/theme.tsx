import {
  colors,
  type ColorScheme,
  MIN_TOUCH_TARGET,
  radii,
  spacing,
  typography,
} from '@touchgrass/shared';
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';
import { useSettingsStore } from '../stores/settings-store';

export interface Theme {
  scheme: 'light' | 'dark';
  colors: ColorScheme;
  spacing: typeof spacing;
  radii: typeof radii;
  typography: typeof typography;
  minTouchTarget: number;
  reduceMotion: boolean;
}

export function buildTheme(scheme: 'light' | 'dark', reduceMotion: boolean): Theme {
  return {
    scheme,
    colors: colors[scheme],
    spacing,
    radii,
    typography,
    minTouchTarget: MIN_TOUCH_TARGET,
    reduceMotion,
  };
}

const ThemeContext = createContext<Theme>(buildTheme('dark', false));

export function ThemeProvider({
  children,
  forcedScheme,
}: {
  children: ReactNode;
  forcedScheme?: 'light' | 'dark';
}) {
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // Light or dark follows the phone unless the person picked one in Settings → Appearance (D-153).
  const system = useColorScheme();
  const appearance = useSettingsStore((s) => s.appearance);
  const scheme =
    forcedScheme ??
    (appearance === 'system' ? (system === 'light' ? 'light' : 'dark') : appearance);
  const theme = useMemo(() => buildTheme(scheme, reduceMotion), [scheme, reduceMotion]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
