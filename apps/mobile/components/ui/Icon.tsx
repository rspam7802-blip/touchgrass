import type { GlyphIcon } from '../icons';
import { useTheme } from '../../src/theme/theme';

export type { GlyphIcon };

/**
 * A TouchGrass icon (D-146). Decorative: the text or button next to it carries the meaning, so screen readers
 * skip it. Colour defaults to the body text colour; the lime signature dot takes the icon's own colour where it
 * would vanish (icons drawn on lime).
 */
export function Icon({
  icon: Glyph,
  size = 18,
  color,
  strokeWidth = 1.75,
  filled = false,
  accent,
}: {
  icon: GlyphIcon;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Fill the shape too (e.g. a selected star). */
  filled?: boolean;
  /** Override the signature dot colour. */
  accent?: string;
}) {
  const theme = useTheme();
  const c = color ?? theme.colors.text;
  const dot = accent ?? (c === theme.colors.onPrimary ? c : theme.colors.primary);
  return (
    <Glyph
      size={size}
      color={c}
      strokeWidth={strokeWidth}
      fill={filled ? c : 'none'}
      accent={dot}
      accessible={false}
      importantForAccessibility="no"
      accessibilityElementsHidden
    />
  );
}
