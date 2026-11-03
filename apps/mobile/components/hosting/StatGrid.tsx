import type { EventAnalytics, HostAnalytics } from '@touchgrass/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { money } from '../../src/features/payments/format';
import { useTheme } from '../../src/theme/theme';
import { Text } from '../ui';

/** Host insight numbers (F-HST-02), each cell read as "label: value". */
export function StatGrid({
  a,
  language,
}: {
  a: HostAnalytics['totals'] | EventAnalytics;
  language: string;
}) {
  const { t } = useTranslation();
  const theme = useTheme();
  const cells: [string, string][] = [
    [t('hosting.views'), String(a.views)],
    [t('hosting.rsvps'), String(a.rsvps)],
    [t('hosting.conversion'), `${String(a.conversionPct)}%`],
    [t('hosting.checkIns'), String(a.checkIns)],
    [t('hosting.noShows'), String(a.noShows)],
    [t('hosting.repeat'), String(a.repeatAttendees)],
    [
      t('hosting.rating'),
      a.averageRating === null
        ? t('hosting.noRatings')
        : `${String(a.averageRating)} ★ (${String(a.ratingsCount)})`,
    ],
    [t('hosting.revenue'), money(a.revenuePaise, language)],
  ];
  return (
    <View style={styles.grid}>
      {cells.map(([label, value]) => (
        <View
          key={label}
          style={[styles.cell, { borderColor: theme.colors.border, borderRadius: theme.radii.md }]}
          accessible
          accessibilityLabel={`${label}: ${value}`}
        >
          <Text variant="caption" tone="muted">
            {label}
          </Text>
          <Text variant="heading">{value}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { borderWidth: 1, padding: 12, minWidth: 140, flexGrow: 1, gap: 4 },
});
