import type { LucideIcon } from 'lucide-react-native';
import { useTheme } from '../../src/theme/theme';

export type { LucideIcon };

/**
 * A Lucide line icon (D-145). Decorative: the text or button next to it carries the meaning, so screen readers
 * skip it. Colour defaults to the body text colour.
 */
export function Icon({
  icon: Glyph,
  size = 18,
  color,
  strokeWidth = 2,
  filled = false,
}: {
  icon: LucideIcon;
  size?: number;
  color?: string;
  strokeWidth?: number;
  /** Fill the shape too (e.g. a selected star). */
  filled?: boolean;
}) {
  const theme = useTheme();
  const c = color ?? theme.colors.text;
  return (
    <Glyph
      size={size}
      color={c}
      strokeWidth={strokeWidth}
      fill={filled ? c : 'none'}
      accessible={false}
      importantForAccessibility="no"
      accessibilityElementsHidden
    />
  );
}
