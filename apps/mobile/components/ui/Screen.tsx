import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/theme';
import { OfflineBanner } from './OfflineBanner';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  testID?: string;
}

/** Base screen: safe area, themed background, offline banner, scroll so 200% text never clips. */
export function Screen({ children, scroll = true, testID }: ScreenProps) {
  const theme = useTheme();
  const content = (
    <View style={[styles.content, { padding: theme.spacing.xl, gap: theme.spacing.lg }]}>
      {children}
    </View>
  );
  return (
    <SafeAreaView
      testID={testID}
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      edges={['top', 'bottom']}
    >
      <OfflineBanner />
      {scroll ? <ScrollView contentContainerStyle={styles.grow}>{content}</ScrollView> : content}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grow: { flexGrow: 1 },
  content: { flexGrow: 1 },
});
