import { MapPin } from 'lucide-react-native';
import type { EventWhere } from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useSavedVenues, useVenueFromPlace, useVenueSearch } from '../../src/features/events/api';
import { errorMessage } from '../../src/lib/errors';
import { Chip, IconText, ListRow, TextField } from '../ui';

export interface PickedPlace {
  where: EventWhere;
  label: string;
}

const HYDERABAD = { lat: 17.385, lng: 78.4867 };

/** Search a place (or tap a saved one) for crew schedules and plan suggestions. */
export function VenuePicker({
  picked,
  onPick,
  testID = 'venue-picker',
}: {
  picked: PickedPlace | null;
  onPick: (p: PickedPlace) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const session = useMemo(() => Crypto.randomUUID(), []);
  const search = useVenueSearch(query, HYDERABAD, session);
  const saved = useSavedVenues();
  const fromPlace = useVenueFromPlace();
  const choose = (p: PickedPlace): void => {
    setQuery('');
    setError(null);
    onPick(p);
  };
  return (
    <View style={styles.wrap} testID={testID}>
      {picked ? (
        <IconText icon={MapPin} accessibilityLiveRegion="polite" testID={`${testID}-picked`}>
          {picked.label}
        </IconText>
      ) : null}
      <TextField
        label={t('events.searchPlace')}
        value={query}
        onChangeText={setQuery}
        error={error}
        testID={`${testID}-search`}
      />
      {search.data?.venues.map((v) => (
        <ListRow
          key={v.id}
          label={v.name}
          detail={v.address}
          testID={`${testID}-venue-${v.id}`}
          onPress={() => {
            choose({ where: { venueId: v.id }, label: v.name });
          }}
        />
      ))}
      {search.data?.places.map((p) => (
        <ListRow
          key={p.placeId}
          label={p.primaryText}
          detail={p.secondaryText}
          onPress={() => {
            void fromPlace.mutateAsync({ placeId: p.placeId, sessionToken: session }).then(
              (v) => {
                choose({ where: { venueId: v.id }, label: v.name });
              },
              (err: unknown) => {
                setError(errorMessage(t, err));
              },
            );
          }}
        />
      ))}
      {(saved.data?.items.length ?? 0) > 0 ? (
        <View style={styles.chips}>
          {saved.data?.items.map((v) => (
            <Chip
              key={v.id}
              label={v.name}
              kind="radio"
              selected={
                picked !== null && 'venueId' in picked.where && picked.where.venueId === v.id
              }
              onToggle={() => {
                choose({ where: { venueId: v.id }, label: v.name });
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
