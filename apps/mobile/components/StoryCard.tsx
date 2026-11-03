import { forwardRef, type ComponentRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../src/theme/theme';
import { Text } from './ui';

export type StoryCardRef = ComponentRef<typeof View>;

/** A 9:16 card drawn for capture (Instagram Stories, WhatsApp status), F-GRW-02. */
export const StoryCard = forwardRef<
  StoryCardRef,
  { title: string; lines: string[]; footer: string; testID?: string }
>(function StoryCard({ title, lines, footer, testID }, ref) {
  const theme = useTheme();
  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.card, { backgroundColor: theme.colors.primary }]}
      testID={testID}
    >
      <Text variant="label" tone="onPrimary">
        TouchGrass
      </Text>
      <Text variant="display" tone="onPrimary" accessibilityRole="header">
        {title}
      </Text>
      {lines.map((l) => (
        <Text key={l} variant="title" tone="onPrimary">
          {l}
        </Text>
      ))}
      <Text variant="label" tone="onPrimary" style={styles.footer}>
        {footer}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { aspectRatio: 9 / 16, padding: 28, gap: 14, borderRadius: 16, justifyContent: 'center' },
  footer: { marginTop: 'auto' },
});
