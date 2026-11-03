import { Star } from './icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme } from '../src/theme/theme';
import { Icon, Text } from './ui';

export interface StarRatingProps {
  /** Group label read before the stars, e.g. "Rate the plan". */
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  testID?: string;
}

const STARS = [1, 2, 3, 4, 5] as const;

/** Five 44 pt stars as a radio group: each star announces "N stars" and whether it is selected. */
export function StarRating({ label, value, onChange, testID }: StarRatingProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  return (
    <View style={styles.wrap}>
      <Text variant="label">{label}</Text>
      <View
        style={styles.row}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        testID={testID}
      >
        {STARS.map((n) => {
          const filled = value !== null && n <= value;
          return (
            <Pressable
              key={n}
              accessibilityRole="radio"
              accessibilityLabel={t('after.star', { count: n })}
              accessibilityState={{ checked: value === n }}
              onPress={() => {
                onChange(n);
              }}
              hitSlop={4}
              style={[
                styles.star,
                { minWidth: theme.minTouchTarget, minHeight: theme.minTouchTarget },
              ]}
              testID={testID ? `${testID}-${n}` : undefined}
            >
              <Icon
                icon={Star}
                size={30}
                filled={filled}
                color={filled ? theme.colors.primary : theme.colors.inputBorder}
                strokeWidth={1.8}
              />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4 },
  row: { flexDirection: 'row', gap: 4 },
  star: { alignItems: 'center', justifyContent: 'center' },
});
