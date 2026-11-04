import type { Interest } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { localized } from '../../src/features/catalog/api';
import { useTheme } from '../../src/theme/theme';
import { Book, Bowl, Dice, Flower2, type GlyphIcon, Grid, People, Ticket, Zap } from '../icons';
import { AnimatedPressable, Icon, Text, usePressScale } from '../ui';

/** One icon per interest group (D-158); anything new falls back to the grid. */
const GROUP_ICON: Record<string, GlyphIcon> = {
  food: Bowl,
  active: Zap,
  creative: Flower2,
  culture: Ticket,
  games: Dice,
  learning: Book,
  community: People,
};
const TILE = 60;

/**
 * Category tiles across the top of Explore (D-158), like the category row of big events apps: "All", then
 * every interest, scrolling sideways. Picking one filters the feed; picking it again (or "All") clears it.
 */
export function CategoryRail({
  interests,
  selected,
  onSelect,
}: {
  interests: Interest[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="radiogroup"
      accessibilityLabel={t('explore.categories')}
      testID="category-rail"
    >
      <Tile
        label={t('explore.all')}
        icon={Grid}
        selected={selected === null}
        onPress={() => {
          onSelect(null);
        }}
        testID="category-all"
      />
      {interests.map((i) => (
        <Tile
          key={i.id}
          label={localized(i.name, i18n.language)}
          icon={GROUP_ICON[i.category] ?? Grid}
          selected={selected === i.id}
          onPress={() => {
            onSelect(selected === i.id ? null : i.id);
          }}
          testID={`category-${i.slug}`}
        />
      ))}
    </ScrollView>
  );
}

function Tile({
  label,
  icon,
  selected,
  onPress,
  testID,
}: {
  label: string;
  icon: GlyphIcon;
  selected: boolean;
  onPress: () => void;
  testID: string;
}) {
  const theme = useTheme();
  const press = usePressScale(0.92);
  return (
    <AnimatedPressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      testID={testID}
      style={[styles.tile, press.scaleStyle]}
    >
      <View
        style={[
          styles.circle,
          {
            backgroundColor: selected ? theme.colors.primary : theme.colors.surface,
            borderColor: selected ? theme.colors.primary : theme.colors.border,
          },
        ]}
      >
        <Icon icon={icon} size={24} color={selected ? theme.colors.onPrimary : theme.colors.text} />
      </View>
      <Text
        variant="caption"
        numberOfLines={1}
        tone={selected ? 'primary' : 'muted'}
        style={styles.label}
      >
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  row: { gap: 14, paddingRight: 8 },
  tile: { width: 68, alignItems: 'center', gap: 6, minHeight: 44 },
  circle: {
    width: TILE,
    height: TILE,
    borderRadius: TILE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { width: 68, textAlign: 'center' },
});
