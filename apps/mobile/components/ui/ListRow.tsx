import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../../src/theme/theme';
import { Text } from './Text';

export interface ListRowProps {
  label: string;
  detail?: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
  testID?: string;
}

/** Navigation row (settings lists). */
export function ListRow({ label, detail, onPress, tone = 'default', testID }: ListRowProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityHint={t('a11y.opensScreen', { screen: label })}
      onPress={onPress}
      style={[
        styles.row,
        { minHeight: theme.minTouchTarget + 8, borderBottomColor: theme.colors.border },
      ]}
    >
      <Text tone={tone === 'danger' ? 'danger' : 'default'} style={styles.label}>
        {label}
      </Text>
      {detail ? <Text tone="muted">{detail}</Text> : null}
      <Text tone="muted" importantForAccessibility="no" accessibilityElementsHidden>
        ›
      </Text>
    </Pressable>
  );
}

export interface SwitchRowProps {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  /** A short explanation under the label (read after it). */
  hint?: string;
  testID?: string;
}

/** Labelled toggle; the whole row is the touch target. */
export function SwitchRow({
  label,
  value,
  onChange,
  disabled = false,
  hint,
  testID,
}: SwitchRowProps) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <View
      style={[
        styles.row,
        { minHeight: theme.minTouchTarget + 8, borderBottomColor: theme.colors.border },
      ]}
    >
      <View style={styles.label} importantForAccessibility="no-hide-descendants">
        <Text>{label}</Text>
        {hint ? (
          <Text variant="caption" tone="muted">
            {hint}
          </Text>
        ) : null}
      </View>
      <Switch
        testID={testID}
        accessibilityRole="switch"
        accessibilityLabel={label}
        accessibilityHint={hint ? `${hint} ${t('a11y.switchHint')}` : t('a11y.switchHint')}
        accessibilityState={{ checked: value, disabled }}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
        trackColor={{ true: theme.colors.primary, false: theme.colors.border }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: { flex: 1 },
});
