import type { ReactNode, RefObject } from 'react';
import { ScrollView, type ScrollViewInstance, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../../src/theme/theme';
import { OfflineBanner } from './OfflineBanner';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  testID?: string;
  /** Lets a screen scroll a field into view (e.g. a search whose results open below it). */
  scrollRef?: RefObject<ScrollViewInstance | null>;
}

/** Room between blocks on a screen: generous, so each section reads on its own (D-151). */
const SECTION_GAP = 22;

/** Base screen: safe area, themed background, offline banner, scroll so 200% text never clips. */
export function Screen({ children, scroll = true, testID, scrollRef }: ScreenProps) {
  const theme = useTheme();
  const content = (
    <View
      style={[
        styles.content,
        {
          paddingHorizontal: theme.spacing.xl - 4,
          paddingTop: theme.spacing.md,
          paddingBottom: theme.spacing.xxxl,
          gap: SECTION_GAP,
        },
      ]}
    >
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
      {scroll ? (
        // "handled": a tap on a result while the keyboard is open selects it, instead of only closing the
        // keyboard (search results on Plot and Search were unpickable on the first tap).
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.grow}
          keyboardShouldPersistTaps="handled"
          testID={testID ? `${testID}-scroll` : undefined}
          keyboardDismissMode="on-drag"
        >
          {content}
        </ScrollView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  grow: { flexGrow: 1 },
  content: { flexGrow: 1 },
});
