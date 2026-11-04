import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AllPlansRail } from '../../components/explore/AllPlansRail';
import { PersonRow } from '../../components/PersonRow';
import { SegmentedTabs } from '../../components/SegmentedTabs';
import {
  EmptyState,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../components/ui';
import { type SearchType, useSearch } from '../../src/features/discovery/api';
import { errorMessage } from '../../src/lib/errors';

const DEBOUNCE_MS = 300;

/** Search plans, people, places and crews (F-DSC-09). Results follow the same visibility rules as browsing. */
export default function SearchScreen() {
  const { t } = useTranslation();
  const router = useRouter();
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
      {query.trim().length < 2 ? null : q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState
          message={errorMessage(t, q.error) ?? undefined}
          onRetry={() => void q.refetch()}
        />
      ) : nothing ? (
        <EmptyState body={t('discover.noResults', { q: query.trim() })} />
      ) : (
        <>
          {data && data.events.length > 0 ? (
            <AllPlansRail
              items={data.events}
              gutter={20}
              title={t('discover.resultsEvents')}
              testID="search-plans"
              onOpen={(e) => {
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
            <ListRow
              key={v.id}
              label={v.name}
              detail={[v.neighbourhoodName, v.address].filter(Boolean).join(' · ')}
              testID={`venue-${v.id}`}
              onPress={() => {
                router.push({ pathname: '/plot', params: { venueId: v.id, venueName: v.name } });
              }}
            />
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
