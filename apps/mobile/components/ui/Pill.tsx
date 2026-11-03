import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../src/theme/theme';
import { Icon, type GlyphIcon } from './Icon';
import { Text } from './Text';

export type PillTone = 'primary' | 'accent' | 'glass' | 'dark';

/**
 * Small non-interactive label ("PLAN", "Women only", "100 m away"). Decorative inside cards whose own label
 * already says the same thing, so callers hide it from screen readers there.
 */
export function Pill({
  label,
  tone = 'glass',
  icon,
}: {
  label: string;
  tone?: PillTone;
  icon?: GlyphIcon;
}) {
  const theme = useTheme();
  const look = {
    primary: { bg: theme.colors.primary, fg: theme.colors.onPrimary, border: theme.colors.primary },
    accent: { bg: theme.colors.accent, fg: theme.colors.onAccent, border: theme.colors.accent },
    glass: { bg: theme.colors.surfaceAlt, fg: theme.colors.text, border: theme.colors.border },
    // Over photos: a dark scrim keeps light text readable on any image.
    dark: { bg: 'rgba(0,0,0,0.65)', fg: '#FFFFFF', border: 'rgba(255,255,255,0.2)' },
  }[tone];
  return (
    <View
      style={[
        styles.pill,
        { backgroundColor: look.bg, borderColor: look.border, borderRadius: theme.radii.pill },
      ]}
    >
      {icon ? <Icon icon={icon} size={12} color={look.fg} strokeWidth={2.5} /> : null}
      <Text variant="caption" style={{ color: look.fg, fontWeight: '700' }}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
