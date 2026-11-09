import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSaveVenue, useSavedVenues } from '../src/features/events/api';
import { useTheme } from '../src/theme/theme';
import { Heart } from './icons';
import { Icon, IconButton } from './ui';

/** Heart next to a venue: saved places show up first when plotting a plan or picking a crew spot. */
export function SaveVenueToggle({ venueId, name }: { venueId: string; name: string }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const saved = useSavedVenues();
  const save = useSaveVenue();
  const isSaved = saved.data?.items.some((v) => v.id === venueId) ?? false;
  return (
    <IconButton
      icon={
        <Icon
          icon={Heart}
          size={18}
          color={isSaved ? theme.colors.primary : theme.colors.textMuted}
          filled={isSaved}
        />
      }
      label={isSaved ? t('events.unsaveVenue', { name }) : t('events.saveVenue', { name })}
      onPress={() => {
        if (save.isPending) return;
        save.mutate({ venueId, saved: !isSaved });
      }}
      testID={`save-venue-${venueId}`}
    />
  );
}

/** A venue row with the save toggle beside it. */
export function VenueRowWithSave({
  venueId,
  name,
  children,
}: {
  venueId: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.row}>
      <View style={styles.grow}>{children}</View>
      <SaveVenueToggle venueId={venueId} name={name} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flex: 1 },
});
