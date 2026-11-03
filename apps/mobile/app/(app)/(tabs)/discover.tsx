import { type FeedWhen, type GeoPoint } from '@touchgrass/shared';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { FreeNowStrip } from '../../../components/engagement/FreeNowStrip';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ChipGroup } from '../../../components/ChipGroup';
import { DiscoverMap } from '../../../components/DiscoverMap';
import { EventCard } from '../../../components/EventCard';
import { SegmentedTabs } from '../../../components/SegmentedTabs';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  Screen,
  Text,
} from '../../../components/ui';
import { localized, useInterests, useVibeTags } from '../../../src/features/catalog/api';
import { useFeed, useFeedClick } from '../../../src/features/discovery/api';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  type DiscoverFilters,
  TOGGLES,
  type Toggle,
} from '../../../src/features/discovery/filters';
import { flatten } from '../../../src/features/social/api';
import { useIsOffline } from '../../../src/hooks/use-is-offline';
import { errorMessage } from '../../../src/lib/errors';
import { NotificationBell } from '../../../components/NotificationBell';
import { useFlag } from '../../../src/features/app-config/use-flag';

const WHENS: FeedWhen[] = ['any', 'tonight', 'tomorrow', 'weekend'];
const RADII = [2, 5, 10, 25];
const QUICK: Toggle[] = ['free', 'soloFriendly', 'squadGoing', 'smallGroup'];

/** Discover (F-DSC-01..08): ranked feed with quick filters, a full filter panel, and a map. */
export default function DiscoverScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const offline = useIsOffline();
  const [filters, setFilters] = useState<DiscoverFilters>(DEFAULT_FILTERS);
  const [location, setLocation] = useState<GeoPoint | null>(null);
  const [locationAsked, setLocationAsked] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<'list' | 'map'>('list');
  const mapEnabled = useFlag('map_view');
  const feed = useFeed(filters, location);
  const click = useFeedClick();
  const interests = useInterests();
  const vibes = useVibeTags();

  useEffect(() => {
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      setLocationAsked(perm.granted || !perm.canAskAgain);
      if (!perm.granted) return;
      const pos = await Location.getLastKnownPositionAsync();
      if (pos) setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    })();
  }, []);

  const askLocation = async (): Promise<void> => {
    const perm = await Location.requestForegroundPermissionsAsync();
    setLocationAsked(true);
    if (!perm.granted) return;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
  };

  const set = <K extends keyof DiscoverFilters>(key: K, value: DiscoverFilters[K]): void => {
    setFilters((f) => ({ ...f, [key]: value }));
  };
  const firstPage = feed.data?.pages[0];
  const items = flatten(feed.data);
  const openEvent = (id: string, position: number | null): void => {
    if (firstPage && position !== null)
      click.mutate({ requestId: firstPage.requestId, eventId: id, position });
    router.push({ pathname: '/events/[id]', params: { id } });
  };
  const nFilters = activeFilterCount(filters);
  const weather = firstPage?.weather;

  let body;
  if (view === 'map' && mapEnabled) {
    body = (
      <DiscoverMap
        center={location ?? firstPage?.center ?? { lat: 17.385, lng: 78.4867 }}
        filters={filters}
        onOpen={(pin) => {
          openEvent(pin.id, null);
        }}
      />
    );
  } else if (feed.isPending) body = <LoadingState />;
  else if (feed.isError)
    body = offline ? (
      <OfflineState onRetry={() => void feed.refetch()} />
    ) : (
      <ErrorState
        message={errorMessage(t, feed.error) ?? undefined}
        onRetry={() => void feed.refetch()}
      />
    );
  else if (items.length === 0)
    body = (
      <EmptyState
        body={t('discover.empty')}
        // With the filter panel open its own "Clear filters" is right there; offer plotting instead.
        actionLabel={nFilters > 0 && !showFilters ? t('discover.clearFilters') : t('events.plot')}
        onAction={() => {
          if (nFilters > 0 && !showFilters) setFilters(DEFAULT_FILTERS);
          else router.push('/plot');
        }}
      />
    );
  else
    body = (
      <>
        {items.map((item, position) => (
          <EventCard
            key={item.id}
            event={item}
            feed={item}
            onOpen={() => {
              openEvent(item.id, position);
            }}
          />
        ))}
        {feed.hasNextPage ? (
          <Button
            label={t('common.seeAll')}
            variant="ghost"
            loading={feed.isFetchingNextPage}
            onPress={() => void feed.fetchNextPage()}
            testID="feed-more"
          />
        ) : null}
      </>
    );

  return (
    <Screen testID="discover-screen">
      <FreeNowStrip />
      <View style={styles.header}>
        <Text variant="title" accessibilityRole="header" style={styles.grow}>
          {t('discover.title')}
        </Text>
        <Button
          label={t('discover.search')}
          variant="secondary"
          onPress={() => {
            router.push('/search');
          }}
          testID="open-search"
        />
        <NotificationBell />
      </View>
      {weather ? (
        <Text tone="muted" testID="weather-chip">
          {t('discover.weatherNow', {
            temp: Math.round(weather.tempC),
            condition: t(`discover.conditions.${weather.condition}`),
          })}
        </Text>
      ) : null}
      {!location && !locationAsked ? (
        <View style={styles.row}>
          <Text tone="muted" style={styles.grow}>
            {t('discover.locationPrompt')}
          </Text>
          <Button
            label={t('discover.useLocation')}
            variant="secondary"
            onPress={() => void askLocation()}
            testID="use-location"
          />
        </View>
      ) : null}
      <View style={styles.row}>
        {WHENS.map((w) => (
          <Chip
            key={w}
            kind="radio"
            label={t(`discover.${w}`)}
            selected={filters.when === w}
            onToggle={() => {
              set('when', w);
            }}
            testID={`when-${w}`}
          />
        ))}
      </View>
      <View style={styles.row}>
        {QUICK.map((k) => (
          <Chip
            key={k}
            label={t(`discover.${k}`)}
            selected={filters[k]}
            onToggle={() => {
              set(k, !filters[k]);
            }}
            testID={`toggle-${k}`}
          />
        ))}
        <Button
          label={
            nFilters > 0 ? `${t('discover.filters')} (${String(nFilters)})` : t('discover.filters')
          }
          variant="ghost"
          accessibilityState={{ expanded: showFilters }}
          onPress={() => {
            setShowFilters((s) => !s);
          }}
          testID="more-filters"
        />
      </View>
      {showFilters ? (
        <View style={styles.panel} testID="filters-panel">
          <Text variant="label">{t('discover.sortLabel')}</Text>
          <View style={styles.row}>
            {(['recommended', 'soonest', 'nearest'] as const).map((s) => (
              <Chip
                key={s}
                kind="radio"
                label={t(`discover.sort_${s}`)}
                selected={filters.sort === s}
                onToggle={() => {
                  set('sort', s);
                }}
                testID={`sort-${s}`}
              />
            ))}
          </View>
          <View style={styles.row}>
            {RADII.map((km) => (
              <Chip
                key={km}
                kind="radio"
                label={t('discover.distance', { km })}
                selected={filters.radiusKm === km}
                onToggle={() => {
                  set('radiusKm', km);
                }}
                testID={`radius-${String(km)}`}
              />
            ))}
          </View>
          <View style={styles.row}>
            {TOGGLES.filter((k) => !QUICK.includes(k)).map((k) => (
              <Chip
                key={k}
                label={t(`discover.${k}`)}
                selected={filters[k]}
                onToggle={() => {
                  set(k, !filters[k]);
                }}
                testID={`toggle-${k}`}
              />
            ))}
          </View>
          <ChipGroup
            label={t('discover.category')}
            options={(interests.data?.items ?? []).map((i) => ({
              id: i.id,
              label: `${i.emoji} ${localized(i.name, i18n.language)}`,
            }))}
            selected={filters.categoryId ? [filters.categoryId] : []}
            onChange={(ids) => {
              set('categoryId', ids[0] ?? null);
            }}
            mode="single"
            testIDPrefix="filter-category"
          />
          <ChipGroup
            label={t('discover.vibes')}
            options={(vibes.data?.items ?? []).map((v) => ({
              id: v.id,
              label: `${v.emoji} ${localized(v.name, i18n.language)}`,
            }))}
            selected={filters.vibeTagIds}
            onChange={(ids) => {
              set('vibeTagIds', ids);
            }}
            mode="multi"
            max={5}
            testIDPrefix="filter-vibe"
          />
          {nFilters > 0 ? (
            <Button
              label={t('discover.clearFilters')}
              variant="ghost"
              onPress={() => {
                setFilters(DEFAULT_FILTERS);
              }}
              testID="clear-filters"
            />
          ) : null}
        </View>
      ) : null}
      {mapEnabled ? (
        <SegmentedTabs
          tabs={[
            { key: 'list', label: t('discover.list') },
            { key: 'map', label: t('discover.map') },
          ]}
          value={view}
          onChange={setView}
        />
      ) : null}
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  grow: { flexGrow: 1, flexShrink: 1 },
  panel: { gap: 12 },
});
