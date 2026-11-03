import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { useTheme } from '../../src/theme/theme';
import { Text } from './Text';

export interface TextFieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | null;
}

/** Labelled input: visible label, hint and error, all exposed to screen readers. */
export function TextField({ label, hint, error, style, ...rest }: TextFieldProps) {
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: rest.editable === false }}
        placeholderTextColor={theme.colors.textMuted}
        maxFontSizeMultiplier={2}
        style={[
          theme.typography.body,
          styles.input,
          {
            minHeight: theme.minTouchTarget,
            color: theme.colors.text,
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.danger : theme.colors.inputBorder,
            borderRadius: theme.radii.md,
          },
          style,
        ]}
        {...rest}
      />
      {hint && !error ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
      {error ? (
        <Text
          variant="caption"
          tone="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
        >
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  input: { borderWidth: 2, paddingHorizontal: 14, paddingVertical: 10 },
});
