import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { VenueRowWithSave } from '../../components/SaveVenueToggle';
import { AllPlansRail } from '../../components/explore/AllPlansRail';
import { PersonRow } from '../../components/PersonRow';
import { SegmentedTabs } from '../../components/SegmentedTabs';
import {
  Button,
  Chip,
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../components/ui';
import { localized, useInterests } from '../../src/features/catalog/api';
import { type SearchType, useSearch } from '../../src/features/discovery/api';
import {
  clearRecentSearches,
  readRecentSearches,
  rememberSearch,
} from '../../src/features/discovery/recent-searches';
import { errorMessage } from '../../src/lib/errors';

const DEBOUNCE_MS = 300;

const SUGGESTED_INTERESTS = 12;

/**
 * Search plans, people, places and crews (F-DSC-09). Results follow the same visibility rules as browsing.
 * Before anything is typed, and when a search finds nothing, the screen offers the person's recent searches
 * and popular interests to tap (D-183).
 */
export default function SearchScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const interests = useInterests();
  const [recent, setRecent] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [type, setType] = useState<SearchType>('all');
  const q = useSearch(query, type);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(text);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [text]);

  useEffect(() => {
    void readRecentSearches().then(setRecent);
  }, []);
  const remember = (value: string): void => {
    void rememberSearch(value).then(setRecent);
  };
  /** Runs a suggested search at once, without waiting for the typing delay. */
  const run = (value: string): void => {
    setText(value);
    setQuery(value);
    remember(value);
  };
  const ideas = (interests.data?.items ?? [])
    .slice(0, SUGGESTED_INTERESTS)
    .map((i) => localized(i.name, i18n.language));
  const suggestions = (
    <View style={styles.wrap} testID="search-suggestions">
      {recent.length > 0 ? (
        <>
          <View style={styles.head}>
            <Text variant="heading" accessibilityRole="header" style={styles.grow}>
              {t('discover.recentSearches')}
            </Text>
            <Button
              label={t('discover.clearRecent')}
              variant="ghost"
              onPress={() => {
                setRecent([]);
                void clearRecentSearches();
              }}
              testID="search-clear-recent"
            />
          </View>
          {recent.map((r) => (
            <ListRow
              key={r}
              label={r}
              testID={`search-recent-${r}`}
              onPress={() => {
                run(r);
              }}
            />
          ))}
        </>
      ) : null}
      {ideas.length > 0 ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('discover.trySearching')}
          </Text>
          <View style={styles.ideas}>
            {ideas.map((name) => (
              <Chip
                key={name}
                label={name}
                kind="radio"
                selected={false}
                onToggle={() => {
                  run(name);
                }}
                testID={`search-idea-${name}`}
              />
            ))}
          </View>
        </>
      ) : null}
    </View>
  );

  const data = q.data;
  const nothing =
    data &&
    data.events.length === 0 &&
    data.people.length === 0 &&
    data.venues.length === 0 &&
    data.crews.length === 0;
  return (
    <Screen testID="search-screen">
      <TextField
        label={t('discover.search')}
        placeholder={t('discover.searchPlaceholder')}
        value={text}
        onChangeText={setText}
        autoFocus
        returnKeyType="search"
        onSubmitEditing={() => {
          setQuery(text);
          remember(text);
        }}
        testID="search-input"
      />
      <SegmentedTabs
        tabs={[
          { key: 'all', label: t('discover.any') },
          { key: 'events', label: t('discover.resultsEvents') },
          { key: 'people', label: t('discover.resultsPeople') },
          { key: 'venues', label: t('discover.resultsPlaces') },
          { key: 'crews', label: t('discover.resultsCrews') },
        ]}
        value={type}
        onChange={setType}
      />
      {query.trim().length < 2 ? (
        suggestions
      ) : q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState
          message={errorMessage(t, q.error) ?? undefined}
          onRetry={() => void q.refetch()}
        />
      ) : nothing ? (
        <>
          <EmptyState body={t('discover.noResults', { q: query.trim() })} />
          {suggestions}
        </>
      ) : (
        <>
          {data && data.events.length > 0 ? (
            <AllPlansRail
              items={data.events}
              gutter={20}
              title={t('discover.resultsEvents')}
              testID="search-plans"
              onOpen={(e) => {
                remember(query);
                router.push({ pathname: '/events/[id]', params: { id: e.id } });
              }}
            />
          ) : null}
          {data && data.people.length > 0 ? (
            <Text variant="heading" accessibilityRole="header">
              {t('discover.resultsPeople')}
            </Text>
          ) : null}
          {data?.people.map((p) => (
            <PersonRow
              key={p.id}
              person={p}
              onOpen={() => {
                remember(query);
                router.push({ pathname: '/users/[id]', params: { id: p.id } });
              }}
            />
          ))}
          {data && data.venues.length > 0 ? (
            <Text variant="heading" accessibilityRole="header">
              {t('discover.resultsPlaces')}
            </Text>
          ) : null}
          {data?.venues.map((v) => (
            <VenueRowWithSave key={v.id} venueId={v.id} name={v.name}>
              <ListRow
                label={v.name}
                detail={[v.neighbourhoodName, v.address].filter(Boolean).join(' · ')}
                testID={`venue-${v.id}`}
                onPress={() => {
                  router.push({ pathname: '/plot', params: { venueId: v.id, venueName: v.name } });
                }}
              />
            </VenueRowWithSave>
          ))}
          {data && data.crews.length > 0 ? (
            <Text variant="heading" accessibilityRole="header">
              {t('discover.resultsCrews')}
            </Text>
          ) : null}
          {data?.crews.map((c) => (
            <ListRow
              key={c.id}
              label={c.name}
              detail={t('crews.members', { count: c.memberCount })}
              testID={`crew-${c.id}`}
              onPress={() => {
                router.push({ pathname: '/crews/[id]', params: { id: c.id } });
              }}
            />
          ))}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  head: { flexDirection: 'row', alignItems: 'center' },
  grow: { flexGrow: 1, flexShrink: 1 },
  ideas: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
