/**
 * Design tokens shared by mobile and web. Grass green primary, bold and outdoorsy.
 * All foreground/background pairs used for text are checked against WCAG AA in tokens.test.ts.
 */
export const palette = {
  grass50: '#EEFBEF',
  grass100: '#D5F5D8',
  grass200: '#A8EAB0',
  grass300: '#6FD97E',
  grass400: '#3DC452',
  grass500: '#1FA637',
  grass600: '#16852B',
  grass700: '#146A25',
  grass800: '#135421',
  grass900: '#0E3A18',
  sun400: '#FFC83D',
  sun500: '#F5B000',
  sky500: '#2D8CFF',
  clay500: '#E2553D',
  clay600: '#C23E28',
  ink950: '#0B0F0C',
  ink900: '#141A16',
  ink800: '#1E2621',
  ink700: '#2C3630',
  ink500: '#5B6A60',
  ink400: '#7F8C83',
  ink300: '#A9B4AC',
  ink200: '#D3DAD5',
  ink100: '#EBEFEC',
  ink50: '#F6F8F6',
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
    background: palette.ink50,
    surface: palette.white,
    surfaceAlt: palette.grass50,
    border: palette.ink200,
    inputBorder: palette.ink400,
    text: palette.ink950,
    textMuted: palette.ink500,
    primary: palette.grass700,
    onPrimary: palette.white,
    primaryMuted: palette.grass100,
    accent: palette.sun400,
    onAccent: palette.ink950,
    danger: palette.clay600,
    onDanger: palette.white,
    success: palette.grass600,
    info: palette.sky500,
    focus: palette.sky500,
    overlay: 'rgba(11,15,12,0.55)',
  },
  dark: {
    background: palette.ink950,
    surface: palette.ink900,
    surfaceAlt: palette.ink800,
    border: palette.ink700,
    inputBorder: palette.ink500,
    text: palette.ink50,
    textMuted: palette.ink300,
    primary: palette.grass400,
    onPrimary: palette.ink950,
    primaryMuted: palette.grass900,
    accent: palette.sun400,
    onAccent: palette.ink950,
    danger: palette.clay500,
    onDanger: palette.ink950,
    success: palette.grass300,
    info: palette.sky500,
    focus: palette.sun400,
    overlay: 'rgba(0,0,0,0.7)',
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
export const radii = { sm: 6, md: 12, lg: 20, pill: 999 } as const;
export const typography = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '800' },
  title: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '700' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
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
