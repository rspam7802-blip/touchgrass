import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';
import { fontFamilyFor } from '../../src/theme/fonts';
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
      <Text variant="overline" tone="muted" style={styles.upper}>
        {label}
      </Text>
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
            minHeight: FIELD_HEIGHT,
            color: theme.colors.text,
            backgroundColor: theme.colors.surfaceAlt,
            fontFamily: fontFamilyFor(theme.typography.body.fontWeight),
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

const FIELD_HEIGHT = 46;

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  input: { borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 11 },
  upper: { textTransform: 'uppercase' },
});
