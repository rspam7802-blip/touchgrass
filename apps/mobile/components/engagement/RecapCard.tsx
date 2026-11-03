import { MapPin } from 'lucide-react-native';
import type { Recap } from '@touchgrass/shared';
import type { TFunction } from 'i18next';
import { type ComponentRef, forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { localized } from '../../src/features/catalog/api';
import { useTheme } from '../../src/theme/theme';
import { IconText, Text } from '../ui';

export function recapTitle(t: TFunction, r: Recap, language: string): string {
  if (r.period === 'year') return t('recap.yearTitle', { year: r.key });
  const [y, m] = r.key.split('-').map(Number) as [number, number];
  const month = new Intl.DateTimeFormat(`${language}-IN`, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, 15)));
  return t('recap.monthTitle', { month });
}

export type RecapCardRef = ComponentRef<typeof View>;

/** The 9:16 recap card (F-GAM-04), drawn so react-native-view-shot can capture it for Stories and WhatsApp. */
export const RecapCard = forwardRef<RecapCardRef, { recap: Recap }>(function RecapCard(
  { recap },
  ref,
) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const s = recap.stats;
  const stat = (value: string | number, label: string) => (
    <View style={styles.stat} accessible accessibilityLabel={`${String(value)} ${label}`}>
      <Text variant="display" tone="onPrimary">
        {value}
      </Text>
      <Text tone="onPrimary">{label}</Text>
    </View>
  );
  return (
    <View
      ref={ref}
      collapsable={false}
      style={[styles.card, { backgroundColor: theme.colors.primary }]}
      testID="recap-card"
    >
      <Text variant="title" tone="onPrimary" accessibilityRole="header">
        {recapTitle(t, recap, i18n.language)}
      </Text>
      {stat(s.eventsAttended, t('recap.eventsAttended'))}
      {s.eventsHosted > 0 ? stat(s.eventsHosted, t('recap.eventsHosted')) : null}
      {stat(s.peopleMet, t('recap.peopleMet'))}
      {stat(s.neighbourhoods.length, t('recap.neighbourhoods'))}
      {s.neighbourhoods.length > 0 ? (
        <IconText icon={MapPin} tone="onPrimary">
          {s.neighbourhoods.join(' · ')}
        </IconText>
      ) : null}
      {s.topVibe ? (
        <Text tone="onPrimary">
          {t('recap.topVibe')}: {localized(s.topVibe, i18n.language)}
        </Text>
      ) : null}
      {stat(s.longestStreak, t('recap.longestStreak'))}
      {s.badges.length > 0 ? (
        <Text
          tone="onPrimary"
          accessibilityLabel={`${String(s.badges.length)} ${t('recap.badges')}: ${s.badges.map((b) => localized(b.name, i18n.language)).join(', ')}`}
        >
          {`${String(s.badges.length)} ${t('recap.badges')}`}
        </Text>
      ) : null}
      {s.topPeople.length > 0 ? (
        <Text tone="onPrimary">
          {t('recap.topPeople')}: {s.topPeople.map((p) => p.displayName).join(', ')}
        </Text>
      ) : null}
      <Text variant="label" tone="onPrimary" style={styles.tagline}>
        TouchGrass · {t('recap.tagline')}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  card: { aspectRatio: 9 / 16, padding: 24, gap: 10, borderRadius: 16, justifyContent: 'center' },
  stat: { gap: 0 },
  tagline: { marginTop: 'auto' },
});
