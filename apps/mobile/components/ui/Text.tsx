import { typography } from '@touchgrass/shared';
import { Text as RNText, type TextProps as RNTextProps } from 'react-native';
import { useTheme } from '../../src/theme/theme';

export type TextVariant = keyof typeof typography;

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: 'default' | 'muted' | 'primary' | 'danger' | 'onPrimary';
}

/** Themed text. Font scaling is allowed up to 200% (F-A11Y-01); layouts must wrap rather than truncate. */
export function Text({
  variant = 'body',
  tone = 'default',
  style,
  maxFontSizeMultiplier = 2,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const color = {
    default: theme.colors.text,
    muted: theme.colors.textMuted,
    primary: theme.colors.primary,
    danger: theme.colors.danger,
    onPrimary: theme.colors.onPrimary,
  }[tone];
  const role =
    variant === 'display' || variant === 'title' || variant === 'heading' ? 'header' : undefined;
  return (
    <RNText
      accessibilityRole={role}
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[typography[variant], { color }, style]}
      {...rest}
    />
  );
}
