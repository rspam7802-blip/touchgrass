import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useTheme } from '../../src/theme/theme';
import { Text } from './Text';

export interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  loading?: boolean;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  selected?: boolean;
}

/** 44pt minimum touch target, explicit a11y role/state, busy state while loading. */
export function Button({
  label,
  variant = 'primary',
  loading = false,
  disabled,
  selected,
  style,
  accessibilityHint,
  ...rest
}: ButtonProps) {
  const theme = useTheme();
  const palette = {
    primary: { bg: theme.colors.primary, fg: theme.colors.onPrimary, border: theme.colors.primary },
    // Frosted glass, as on the mock's map toggle and secondary actions.
    secondary: { bg: theme.colors.surfaceAlt, fg: theme.colors.text, border: theme.colors.border },
    ghost: { bg: 'transparent', fg: theme.colors.text, border: theme.colors.border },
    danger: { bg: theme.colors.danger, fg: theme.colors.onDanger, border: theme.colors.danger },
  }[variant];
  const isDisabled = disabled === true || loading;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading, selected }}
      disabled={isDisabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: variant === 'ghost' ? theme.minTouchTarget : PROMINENT_HEIGHT,
          minWidth: theme.minTouchTarget,
          backgroundColor: palette.bg,
          borderColor: palette.border,
          borderRadius: theme.radii.pill,
        },
        pressed && !theme.reduceMotion ? styles.pressed : null,
        isDisabled ? styles.disabled : null,
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator
          color={palette.fg}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : (
        <Text
          variant="label"
          style={{ color: palette.fg, textAlign: 'center', fontWeight: '600', letterSpacing: 0.2 }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Filled buttons are a little taller than the 44 pt minimum: calmer, easier to hit (D-151). */
const PROMINENT_HEIGHT = 46;

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pressed: { transform: [{ scale: 0.98 }], opacity: 0.88 },
  disabled: { opacity: 0.5 },
});
