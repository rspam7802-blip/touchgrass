import { BadgeCheck } from 'lucide-react-native';
import type {
  HostRatingSummary,
  Interest,
  MediaVariants,
  ProfileStats,
  VibeTag,
} from '@touchgrass/shared';
import { Image } from 'expo-image';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { localized } from '../src/features/catalog/api';
import { useTheme } from '../src/theme/theme';
import { IconText, Text } from './ui';

export interface ProfileCardProps {
  displayName: string;
  subtitle?: string | null;
  bio: string;
  photos: MediaVariants[];
  interests: Interest[];
  vibeTags: VibeTag[];
  stats: ProfileStats;
  verified: boolean;
  highlightInterestIds?: string[];
  /** Shown once the person has enough host ratings (F-AFT-02). */
  hostRating?: HostRatingSummary | null;
}

/** Profile body shared by "my profile" and other people's profiles. */
export function ProfileCard(p: ProfileCardProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const highlight = new Set(p.highlightInterestIds ?? []);
  return (
    <View style={styles.wrap}>
      {p.photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photos}
          accessibilityRole="list"
        >
          {p.photos.map((ph, i) => (
            <Image
              key={ph.md}
              source={{ uri: ph.lg }}
              style={[styles.photo, { borderRadius: theme.radii.lg }]}
              contentFit="cover"
              accessibilityIgnoresInvertColors
              accessible
              accessibilityLabel={t('a11y.photoSlot', { number: i + 1, total: p.photos.length })}
            />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.titleRow}>
        <Text variant="title">{p.displayName}</Text>
        {p.verified ? (
          <IconText
            icon={BadgeCheck}
            variant="label"
            tone="primary"
            accessibilityLabel={t('profile.verified')}
          >
            {t('profile.verified')}
          </IconText>
        ) : null}
      </View>
      {p.subtitle ? <Text tone="muted">{p.subtitle}</Text> : null}
      {p.hostRating && p.hostRating.average !== null ? (
        <Text tone="primary" testID="host-rating">
          {t('profile.hostRating', {
            rating: p.hostRating.average.toFixed(1),
            count: p.hostRating.count,
          })}
        </Text>
      ) : null}
      <Text tone={p.bio ? 'default' : 'muted'}>{p.bio || t('profile.noBio')}</Text>
      <View style={styles.stats}>
        {[
          [t('profile.eventsAttended'), String(p.stats.eventsAttended)],
          [t('profile.eventsHosted'), String(p.stats.eventsHosted)],
          [t('profile.reliability'), t(`profile.tiers.${p.stats.reliabilityTier}`)],
        ].map(([label, value]) => (
          <View
            key={label}
            accessible
            accessibilityLabel={`${label}: ${value}`}
            style={[
              styles.stat,
              { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md },
            ]}
          >
            <Text variant="heading">{value}</Text>
            <Text variant="caption" tone="muted">
              {label}
            </Text>
          </View>
        ))}
      </View>
      {p.interests.length > 0 ? (
        <View style={styles.section}>
          <Text variant="heading">{t('profile.interests')}</Text>
          <View style={styles.tags}>
            {p.interests.map((i) => (
              <Text
                key={i.id}
                variant="label"
                tone={highlight.has(i.id) ? 'primary' : 'default'}
                style={[
                  styles.tag,
                  { borderColor: theme.colors.border, borderRadius: theme.radii.pill },
                ]}
              >
                {localized(i.name, i18n.language)}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
      {p.vibeTags.length > 0 ? (
        <View style={styles.section}>
          <Text variant="heading">{t('profile.vibes')}</Text>
          <View style={styles.tags}>
            {p.vibeTags.map((v) => (
              <Text
                key={v.id}
                variant="label"
                style={[
                  styles.tag,
                  { borderColor: theme.colors.border, borderRadius: theme.radii.pill },
                ]}
              >
                {localized(v.name, i18n.language)}
              </Text>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  photos: { gap: 8 },
  photo: { width: 220, aspectRatio: 4 / 5 },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexGrow: 1, minWidth: 96, padding: 12, gap: 2 },
  section: { gap: 8 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
});
