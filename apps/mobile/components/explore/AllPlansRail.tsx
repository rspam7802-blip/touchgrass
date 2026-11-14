import type { EventSummary, FeedItem } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useTheme } from '../../src/theme/theme';
import { EventCard } from '../EventCard';
import { FadeIn, staggerDelay, Text } from '../ui';

const GAP = 12;
const PEEK = 36;

const isFeedItem = (e: EventSummary): e is FeedItem => 'reasons' in e && 'preview' in e;

/**
 * Plans as one sideways row of full plan cards (D-160): who's going, why it's here, how far, all on the
 * card. Snaps card by card, with the next one peeking; can load more as you reach the end. Used for
 * "All plans" on Explore and for plan results in search, so plan cards never stack vertically.
 */
export function AllPlansRail<T extends EventSummary>({
  items,
  gutter,
  onOpen,
  onEnd,
  loadingMore = false,
  title,
  testID = 'all-plans-rail',
}: {
  items: T[];
  gutter: number;
  onOpen: (item: T, position: number) => void;
  onEnd?: () => void;
  loadingMore?: boolean;
  title?: string;
  testID?: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const cardWidth = width - gutter * 2 - PEEK;
  return (
    <View style={styles.wrap} testID={testID}>
      <Text variant="heading" accessibilityRole="header" testID={`${testID}-title`}>
        {title ?? t('explore.allPlans')}
      </Text>
      <FlatList
        data={items}
        horizontal
        // A tap on a card opens it even while the keyboard is up (search results), instead of only closing it.
        keyboardShouldPersistTaps="handled"
        keyExtractor={(i) => i.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={cardWidth + GAP}
        decelerationRate="fast"
        style={{ marginHorizontal: -gutter }}
        contentContainerStyle={{ paddingHorizontal: gutter, gap: GAP }}
        onEndReached={onEnd}
        onEndReachedThreshold={1.5}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.more}>
              <ActivityIndicator color={theme.colors.primary} />
            </View>
          ) : undefined
        }
        renderItem={({ item, index }) => (
          <FadeIn delay={staggerDelay(index, 60, 3)} distance={8} style={{ width: cardWidth }}>
            <EventCard
              event={item}
              feed={isFeedItem(item) ? item : undefined}
              onOpen={() => {
                onOpen(item, index);
              }}
            />
          </FadeIn>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  more: { justifyContent: 'center', paddingHorizontal: 16 },
});
