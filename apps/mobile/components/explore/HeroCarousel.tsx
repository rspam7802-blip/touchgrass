import type { FeedItem } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Animated,
  type FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { formatWhen, locationLabel } from '../../src/features/events/format';
import { useScreenReader } from '../../src/hooks/use-screen-reader';
import { useTheme } from '../../src/theme/theme';
import { Compass } from '../icons';
import { AnimatedPressable, Icon, Pill, Text, usePressScale } from '../ui';

const GAP = 12;
const PEEK = 28;
const HEIGHT = 300;
/** How long each card stays before the carousel moves on by itself. */
export const HERO_AUTOPLAY_MS = 5000;

/**
 * The big swipeable cards at the top of Explore (D-155): one card at a time with the next one peeking,
 * snapping into place; neighbours shrink and dim as you swipe. It moves on every few seconds unless the
 * person is touching it, a screen reader is on or Reduce Motion is set. Each card is a labelled button.
 */
export function HeroCarousel({
  items,
  gutter,
  onOpen,
}: {
  items: FeedItem[];
  /** The screen's side padding, so the carousel can run edge to edge. */
  gutter: number;
  onOpen: (item: FeedItem, position: number) => void;
}) {
  const { width } = useWindowDimensions();
  const theme = useTheme();
  const screenReader = useScreenReader();
  const cardWidth = width - gutter * 2 - PEEK;
  const step = cardWidth + GAP;
  const scrollX = useRef(new Animated.Value(0)).current;
  const list = useRef<FlatList<FeedItem>>(null);
  const [index, setIndex] = useState(0);
  const [touching, setTouching] = useState(false);

  const autoplay = !touching && !screenReader && !theme.reduceMotion && items.length > 1;
  useEffect(() => {
    if (!autoplay) return undefined;
    const timer = setTimeout(() => {
      const next = (index + 1) % items.length;
      list.current?.scrollToOffset({ offset: next * step, animated: true });
      setIndex(next);
    }, HERO_AUTOPLAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [autoplay, index, items.length, step]);

  const settle = (e: NativeSyntheticEvent<NativeScrollEvent>): void => {
    setIndex(
      Math.max(0, Math.min(items.length - 1, Math.round(e.nativeEvent.contentOffset.x / step))),
    );
    setTouching(false);
  };

  return (
    <View style={{ marginHorizontal: -gutter }} testID="hero-carousel">
      <Animated.FlatList
        ref={list}
        data={items}
        horizontal
        // A tap on a card opens it even while the keyboard is up (search results), instead of only closing it.
        keyboardShouldPersistTaps="handled"
        keyExtractor={(i) => i.id}
        showsHorizontalScrollIndicator={false}
        snapToInterval={step}
        decelerationRate="fast"
        disableIntervalMomentum
        contentContainerStyle={{ paddingHorizontal: gutter, gap: GAP }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => {
          setTouching(true);
        }}
        onMomentumScrollEnd={settle}
        renderItem={({ item, index: i }) => {
          const range = [(i - 1) * step, i * step, (i + 1) * step];
          const scale = theme.reduceMotion
            ? 1
            : scrollX.interpolate({
                inputRange: range,
                outputRange: [0.92, 1, 0.92],
                extrapolate: 'clamp',
              });
          const opacity = theme.reduceMotion
            ? 1
            : scrollX.interpolate({
                inputRange: range,
                outputRange: [0.6, 1, 0.6],
                extrapolate: 'clamp',
              });
          return (
            <Animated.View style={{ width: cardWidth, transform: [{ scale }], opacity }}>
              <HeroCard
                item={item}
                onOpen={() => {
                  onOpen(item, i);
                }}
              />
            </Animated.View>
          );
        }}
      />
      {items.length > 1 ? (
        <View
          style={styles.dots}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          {items.map((it, i) => {
            const range = [(i - 1) * step, i * step, (i + 1) * step];
            const grow = theme.reduceMotion
              ? i === index
                ? 2.6
                : 1
              : scrollX.interpolate({
                  inputRange: range,
                  outputRange: [1, 2.6, 1],
                  extrapolate: 'clamp',
                });
            const dim = theme.reduceMotion
              ? i === index
                ? 1
                : 0.35
              : scrollX.interpolate({
                  inputRange: range,
                  outputRange: [0.35, 1, 0.35],
                  extrapolate: 'clamp',
                });
            return (
              <Animated.View
                key={it.id}
                style={[
                  styles.dot,
                  {
                    backgroundColor: theme.colors.primary,
                    opacity: dim,
                    transform: [{ scaleX: grow }],
                  },
                ]}
              />
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

function HeroCard({ item, onOpen }: { item: FeedItem; onOpen: () => void }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const press = usePressScale(0.98);
  const when = formatWhen(item.startsAt, i18n.language, item.timezone);
  const where = locationLabel(t, item.location);
  const going = t('explore.going', { count: item.goingCount });
  return (
    <AnimatedPressable
      accessibilityRole="button"
      accessibilityLabel={[item.title, when, where, going].join(', ')}
      accessibilityHint={t('a11y.opensScreen', { screen: item.title })}
      onPress={onOpen}
      onPressIn={press.onPressIn}
      onPressOut={press.onPressOut}
      testID={`hero-${item.slug}`}
      style={[
        styles.card,
        { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg },
        press.scaleStyle,
      ]}
    >
      {item.cover ? (
        <Image
          source={{ uri: item.cover.lg }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          accessible={false}
          importantForAccessibility="no"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <LinearGradient
          colors={['#1F3A26', '#0F172A', '#000000']}
          style={[StyleSheet.absoluteFill, styles.placeholder]}
        >
          <Icon icon={Compass} size={44} color="#E5FB46" strokeWidth={1.4} />
        </LinearGradient>
      )}
      <LinearGradient
        colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.15)', 'rgba(0,0,0,0.85)']}
        style={styles.shade}
      >
        {item.reasons.includes('featured') ? (
          <View style={styles.pill}>
            <Pill label={t('explore.featured')} tone="dark" />
          </View>
        ) : null}
        <Text variant="title" numberOfLines={2} style={styles.onPhoto}>
          {item.title}
        </Text>
        <Text variant="label" numberOfLines={1} style={styles.onPhotoMuted}>
          {when}
        </Text>
        <Text variant="caption" numberOfLines={1} style={styles.onPhotoMuted}>
          {[where, going].join(' · ')}
        </Text>
      </LinearGradient>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  card: { height: HEIGHT, overflow: 'hidden' },
  placeholder: { alignItems: 'center', justifyContent: 'center' },
  shade: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end', padding: 16, gap: 4 },
  pill: { alignSelf: 'flex-start', marginBottom: 4 },
  onPhoto: { color: '#FFFFFF' },
  onPhotoMuted: { color: '#E5E7EB' },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginTop: 12 },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
