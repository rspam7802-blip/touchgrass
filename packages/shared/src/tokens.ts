/**
 * Design tokens shared by mobile and web: the "matcha" look. Deep forest-black surfaces, frosted cards and a
 * lime (#E5FB46, the logo's colour) accent; the app is dark-only, the web follows the system with a light variant.
 * All foreground/background pairs used for text are checked against WCAG AA in tokens.test.ts.
 */
export const palette = {
  lime400: '#E5FB46',
  lime800: '#3D5E0F',
  lime100: '#EEF6DC',
  lime50: '#E3F7B0',
  forest950: '#0B130E',
  forest900: '#142017',
  forest850: '#1B2B1F',
  forest800: '#26382B',
  forest700: '#5F7565',
  emerald400: '#34D399',
  pink400: '#F472B6',
  pink700: '#BE185D',
  coral400: '#FF6B6B',
  red700: '#B91C1C',
  cyan400: '#22D3EE',
  cyan700: '#0E7490',
  bone50: '#F4F5F0',
  sage300: '#A3B3A7',
  sage600: '#526055',
  sage500: '#6E7C70',
  sage200: '#D7DDD3',
  white: '#FFFFFF',
} as const;

export interface ColorScheme {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  /** Edges of form fields: 3:1 against surfaces (WCAG 1.4.11), unlike decorative `border`. */
  inputBorder: string;
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  primaryMuted: string;
  accent: string;
  onAccent: string;
  danger: string;
  onDanger: string;
  success: string;
  info: string;
  focus: string;
  overlay: string;
}

export const colors: Record<'light' | 'dark', ColorScheme> = {
  light: {
    background: palette.bone50,
    surface: palette.white,
    surfaceAlt: palette.lime100,
    border: palette.sage200,
    inputBorder: palette.sage500,
    text: palette.forest950,
    textMuted: palette.sage600,
    primary: palette.lime800,
    onPrimary: palette.white,
    primaryMuted: palette.lime50,
    accent: palette.pink700,
    onAccent: palette.white,
    danger: palette.red700,
    onDanger: palette.white,
    success: palette.lime800,
    info: palette.cyan700,
    focus: palette.lime800,
    overlay: 'rgba(11,19,14,0.55)',
  },
  dark: {
    background: palette.forest950,
    surface: palette.forest900,
    surfaceAlt: palette.forest850,
    border: palette.forest800,
    inputBorder: palette.forest700,
    text: palette.bone50,
    textMuted: palette.sage300,
    primary: palette.lime400,
    onPrimary: palette.forest950,
    primaryMuted: palette.forest800,
    accent: palette.pink400,
    onAccent: palette.forest950,
    danger: palette.coral400,
    onDanger: palette.forest950,
    success: palette.emerald400,
    info: palette.cyan400,
    focus: palette.lime400,
    overlay: 'rgba(0,0,0,0.72)',
  },
};

export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;
export const radii = { sm: 10, md: 16, lg: 28, pill: 999 } as const;
export const typography = {
  // Spacious, editorial scale (D-151): larger titles with tight tracking, airy body, wide-tracked labels.
  display: { fontSize: 34, lineHeight: 42, fontWeight: '600', letterSpacing: -1 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '600', letterSpacing: -0.6 },
  heading: { fontSize: 18, lineHeight: 25, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 16, lineHeight: 25, fontWeight: '400', letterSpacing: 0 },
  label: { fontSize: 15, lineHeight: 20, fontWeight: '600', letterSpacing: 0.1 },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500', letterSpacing: 0.1 },
  /** Small uppercase section labels ("FREE NOW"). */
  overline: { fontSize: 11, lineHeight: 15, fontWeight: '600', letterSpacing: 1.6 },
} as const;
export const motion = { fast: 150, normal: 250, slow: 400, signalPulse: 2400 } as const;
/** Minimum touch target (pt) for F-A11Y-01. */
export const MIN_TOUCH_TARGET = 44;

/** Relative luminance per WCAG 2.x. */
export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new RangeError(`Expected #RRGGBB, got ${hex}`);
  const n = parseInt(m[1], 16);
  const channel = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}
