import type { MapCluster, MapPin } from '@touchgrass/shared';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, type Region } from 'react-native-maps';
import { useMapPins } from '../src/features/discovery/api';
import { type DiscoverFilters, regionToBox } from '../src/features/discovery/filters';
import { formatWhen } from '../src/features/events/format';
import { useTheme } from '../src/theme/theme';
import { ListRow, Text } from './ui';

/**
 * Map view (F-DSC-03). Pins sit on each plan's public centre; unrevealed mystery plans are drawn as their 2 km
 * circle, never a point. Dense areas come back clustered; tapping a cluster zooms in. The same plans are
 * listed under the map so screen-reader users never depend on the map itself.
 */
export function DiscoverMap({
  center,
  filters,
  onOpen,
}: {
  center: { lat: number; lng: number };
  filters: DiscoverFilters;
  onOpen: (pin: MapPin) => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
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
        style={[styles.map, { borderRadius: theme.radii.md }]}
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
      {q.data?.truncated ? <Text tone="muted">{t('discover.mapTruncated')}</Text> : null}
      {q.data?.clusters.map((c) => (
        <ListRow
          key={`l-${String(c.center.lat)}-${String(c.center.lng)}`}
          label={t('discover.clusterLabel', { count: c.count })}
          onPress={() => {
            zoomInto(c);
          }}
        />
      ))}
      {q.data?.pins.map((p) => (
        <ListRow
          key={`l-${p.id}`}
          label={p.title}
          detail={formatWhen(p.startsAt, i18n.language)}
          testID={`pin-${p.slug}`}
          onPress={() => {
            onOpen(p);
          }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  map: { height: 360 },
  cluster: {
    minWidth: 36,
    minHeight: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
});
