import type { MapCluster, MapPin } from '@touchgrass/shared';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Circle, Marker, type Region } from 'react-native-maps';
import { useMapPins } from '../src/features/discovery/api';
import { type DiscoverFilters, regionToBox } from '../src/features/discovery/filters';
import { formatWhen } from '../src/features/events/format';
import { useTheme } from '../src/theme/theme';
import { MapPin as PinIcon, People } from './icons';
import { FadeIn, Icon, staggerDelay, Text } from './ui';

/**
 * Map view (F-DSC-03), full screen (D-153). Pins sit on each plan's public centre; unrevealed mystery plans are
 * drawn as their 2 km circle, never a point. Dense areas come back clustered; tapping a cluster zooms in.
 * Search and the list/map switch float on top (`overlay`); the plans in view are a swipeable row of cards at
 * the bottom, so screen-reader users never depend on the map itself.
 */
export function DiscoverMap({
  center,
  filters,
  onOpen,
  overlay,
}: {
  center: { lat: number; lng: number };
  filters: DiscoverFilters;
  onOpen: (pin: MapPin) => void;
  overlay?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const map = useRef<MapView>(null);
  const initial: Region = {
    latitude: center.lat,
    longitude: center.lng,
    latitudeDelta: 0.12,
    longitudeDelta: 0.12,
  };
  const [box, setBox] = useState(() => regionToBox(initial));
  const q = useMapPins(box, filters);

  const zoomInto = (c: MapCluster): void => {
    map.current?.animateToRegion({
      latitude: c.center.lat,
      longitude: c.center.lng,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
  };

  return (
    <View style={styles.wrap} testID="discover-map">
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        userInterfaceStyle={theme.scheme}
        initialRegion={initial}
        onRegionChangeComplete={(r: Region) => {
          setBox(regionToBox(r));
        }}
        accessibilityLabel={t('discover.map')}
        testID="discover-mapview"
      >
        {q.data?.pins.map((p) =>
          p.radiusMeters > 0 ? (
            <Circle
              key={p.id}
              center={{ latitude: p.center.lat, longitude: p.center.lng }}
              radius={p.radiusMeters}
              strokeColor={theme.colors.primary}
              fillColor="rgba(20,106,37,0.12)"
            />
          ) : null,
        )}
        {q.data?.pins.map((p) => (
          <Marker
            key={`m-${p.id}`}
            coordinate={{ latitude: p.center.lat, longitude: p.center.lng }}
            title={p.title}
            description={formatWhen(p.startsAt, i18n.language)}
            onCalloutPress={() => {
              onOpen(p);
            }}
            accessibilityLabel={`${p.title}, ${formatWhen(p.startsAt, i18n.language)}`}
          />
        ))}
        {q.data?.clusters.map((c) => (
          <Marker
            key={`c-${String(c.center.lat)}-${String(c.center.lng)}`}
            coordinate={{ latitude: c.center.lat, longitude: c.center.lng }}
            onPress={() => {
              zoomInto(c);
            }}
            accessibilityLabel={t('discover.clusterLabel', { count: c.count })}
          >
            <View style={[styles.cluster, { backgroundColor: theme.colors.primary }]}>
              <Text tone="onPrimary" variant="label">
                {c.count}
              </Text>
            </View>
          </Marker>
        ))}
      </MapView>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
        {overlay ? (
          <View
            style={[
              styles.glass,
              {
                backgroundColor: theme.colors.background,
                borderColor: theme.colors.border,
                borderRadius: theme.radii.lg,
              },
            ]}
          >
            {overlay}
          </View>
        ) : null}
        {q.data?.truncated ? (
          <View
            style={[
              styles.notice,
              { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
            ]}
          >
            <Text variant="caption" tone="muted">
              {t('discover.mapTruncated')}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.bottom} pointerEvents="box-none">
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.rail}
        >
          {q.data?.clusters.map((c) => (
            <Pressable
              key={`l-${String(c.center.lat)}-${String(c.center.lng)}`}
              accessibilityRole="button"
              accessibilityLabel={t('discover.clusterLabel', { count: c.count })}
              onPress={() => {
                zoomInto(c);
              }}
              style={[
                styles.card,
                styles.clusterCard,
                { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
              ]}
            >
              <Icon icon={People} size={16} color={theme.colors.primary} />
              <Text variant="label">{t('discover.clusterLabel', { count: c.count })}</Text>
            </Pressable>
          ))}
          {q.data?.pins.map((p, i) => (
            <FadeIn key={`l-${p.id}`} delay={staggerDelay(i, 50)}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${p.title}, ${formatWhen(p.startsAt, i18n.language)}`}
                testID={`pin-${p.slug}`}
                onPress={() => {
                  onOpen(p);
                }}
                style={[
                  styles.card,
                  { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
                ]}
              >
                <Text variant="label" numberOfLines={2}>
                  {p.title}
                </Text>
                <View style={styles.when}>
                  <Icon icon={PinIcon} size={13} color={theme.colors.primary} />
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {formatWhen(p.startsAt, i18n.language)}
                  </Text>
                </View>
              </Pressable>
            </FadeIn>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  top: { position: 'absolute', left: 12, right: 12, top: 0, gap: 8 },
  glass: { padding: 8, borderWidth: StyleSheet.hairlineWidth, opacity: 0.97 },
  notice: {
    alignSelf: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 12 },
  rail: { gap: 10, paddingHorizontal: 12 },
  card: {
    width: 220,
    minHeight: 64,
    padding: 12,
    gap: 6,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
  },
  clusterCard: { width: 'auto', flexDirection: 'row', alignItems: 'center' },
  when: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cluster: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
});
