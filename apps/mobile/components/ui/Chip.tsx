import { Pressable, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/theme/theme';
import { Text } from './Text';

export interface ChipProps {
  label: string;
  selected: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /** "radio" for single choice groups, "checkbox" for multi-select. */
  kind?: 'checkbox' | 'radio';
  testID?: string;
}

/** Selectable chip for interests, vibes and single-choice lists. */
export function Chip({
  label,
  selected,
  onToggle,
  disabled = false,
  kind = 'checkbox',
  testID,
}: ChipProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      testID={testID}
      accessibilityRole={kind}
      accessibilityLabel={label}
      accessibilityHint={t('a11y.toggleHint')}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={[
        styles.chip,
        {
          minHeight: theme.minTouchTarget,
          borderRadius: theme.radii.pill,
          backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
          borderColor: selected ? theme.colors.primary : theme.colors.border,
          opacity: disabled && !selected ? 0.5 : 1,
        },
      ]}
    >
      <Text
        variant="label"
        style={{
          color: selected ? theme.colors.onPrimary : theme.colors.text,
          fontWeight: selected ? '700' : '500',
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, paddingHorizontal: 18, paddingVertical: 10, justifyContent: 'center' },
});
