import type { ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../../src/theme/theme';
import { Text } from './Text';

/** Round glass button for header actions (bell, profile). Always 44pt; the label is what screen readers hear. */
export function IconButton({
  icon,
  label,
  onPress,
  testID,
}: {
  icon: ReactNode;
  label: string;
  onPress: () => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      hitSlop={4}
      style={({ pressed }) => [
        styles.base,
        {
          width: theme.minTouchTarget,
          height: theme.minTouchTarget,
          borderRadius: theme.minTouchTarget / 2,
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: theme.colors.border,
        },
        pressed && !theme.reduceMotion ? styles.pressed : null,
      ]}
    >
      {typeof icon === 'string' ? (
        <Text importantForAccessibility="no" style={styles.emoji}>
          {icon}
        </Text>
      ) : (
        icon
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' },
  pressed: { transform: [{ scale: 0.94 }] },
  emoji: { fontSize: 18 },
});
