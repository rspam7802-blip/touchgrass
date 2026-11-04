import { StyleSheet, View } from 'react-native';
import { useTheme } from '../src/theme/theme';
import { Skeleton } from './ui';

/** Loading placeholder for the plan feed: card-shaped blocks that shimmer, in place of a spinner (D-154). */
export function FeedSkeleton({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      testID="state-loading"
      style={styles.list}
    >
      {[0, 1].map((i) => (
        <View
          key={i}
          style={[
            styles.card,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.lg,
            },
          ]}
        >
          <Skeleton style={styles.hero} />
          <View style={styles.body}>
            <Skeleton style={styles.lineWide} />
            <Skeleton style={styles.line} />
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 18 },
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  hero: { height: 168, borderRadius: 0 },
  body: { padding: 16, gap: 10 },
  lineWide: { height: 16, width: '70%' },
  line: { height: 12, width: '45%' },
});
