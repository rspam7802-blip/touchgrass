import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../../src/theme/theme';

/** Frosted "glass" card: the matcha surface with a hairline border (the mock's `.glass-card`). */
export function Card({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View
      testID={testID}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.lg,
          padding: CARD_PADDING,
          gap: theme.spacing.md,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const CARD_PADDING = 16;
// A hairline edge instead of a full stroke: the card floats rather than boxes in (D-151).
const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
