import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../src/theme/theme';
import { Icon, type GlyphIcon } from './Icon';
import { Text, type TextProps } from './Text';

/** A line of text led by a small icon (location, date…). The icon is decorative; the text says it all. */
export function IconText({
  icon,
  children,
  tone = 'default',
  ...rest
}: { icon: GlyphIcon } & TextProps) {
  const theme = useTheme();
  const color = {
    default: theme.colors.primary,
    muted: theme.colors.textMuted,
    primary: theme.colors.primary,
    danger: theme.colors.danger,
    onPrimary: theme.colors.onPrimary,
  }[tone];
  return (
    <View style={styles.row}>
      <View style={styles.icon}>
        <Icon icon={icon} size={14} color={color} />
      </View>
      <Text tone={tone} style={styles.text} {...rest}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  icon: { paddingTop: 3 },
  text: { flexShrink: 1 },
});
