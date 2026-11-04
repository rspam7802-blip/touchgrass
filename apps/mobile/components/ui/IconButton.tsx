import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme } from '../../src/theme/theme';
import { AnimatedPressable, usePressScale } from './motion';
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
  const press = usePressScale(0.9);
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      hitSlop={4}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      style={[
        styles.base,
        {
          width: theme.minTouchTarget,
          height: theme.minTouchTarget,
          borderRadius: theme.minTouchTarget / 2,
          backgroundColor: theme.colors.surfaceAlt,
          borderColor: theme.colors.border,
        },
        press.scaleStyle,
      ]}
    >
      {typeof icon === 'string' ? (
        <Text importantForAccessibility="no" style={styles.emoji}>
          {icon}
        </Text>
      ) : (
        icon
      )}
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, overflow: 'hidden' },
  emoji: { fontSize: 18 },
});
