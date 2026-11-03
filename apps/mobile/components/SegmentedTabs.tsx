import { Pressable, StyleSheet, View } from 'react-native';
import { useTheme } from '../src/theme/theme';
import { Text } from './ui';

export interface SegmentedTabsProps<K extends string> {
  tabs: { key: K; label: string; badge?: number }[];
  value: K;
  onChange: (key: K) => void;
}

/** Accessible tab strip (role tablist/tab, selected state, wraps at large text sizes). */
export function SegmentedTabs<K extends string>({ tabs, value, onChange }: SegmentedTabsProps<K>) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" style={styles.wrap}>
      {tabs.map((tab) => {
        const selected = tab.key === value;
        const label = tab.badge ? `${tab.label} (${tab.badge})` : tab.label;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected }}
            onPress={() => {
              onChange(tab.key);
            }}
            style={[
              styles.tab,
              {
                minHeight: theme.minTouchTarget,
                borderRadius: theme.radii.pill,
                backgroundColor: selected ? theme.colors.primary : theme.colors.surfaceAlt,
              },
            ]}
            testID={`tab-${tab.key}`}
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
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tab: { justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 8 },
});
