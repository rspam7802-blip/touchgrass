import type { EventSummary, FeedItem } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { capacityLabel, formatWhen, locationLabel, rsvpLabel } from '../src/features/events/format';
import { useTheme } from '../src/theme/theme';
import { Avatar } from './Avatar';
import { Text } from './ui';

type FeedExtras = Pick<FeedItem, 'preview' | 'via' | 'reasons' | 'distanceMeters' | 'weather'>;

/**
 * A plan in a list: when, where (as revealed), capacity and where the viewer stands. In the Discover feed it
 * also shows who's pulling up, "via" a mutual, why it was suggested, distance and the weather at start.
 */
export function EventCard({
  event,
  onOpen,
  feed,
}: {
  event: EventSummary;
  onOpen: () => void;
  feed?: FeedExtras;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const status = rsvpLabel(t, event);
  const tags = [
    event.type === 'curated' ? t('share.curated') : null,
    event.soloFriendly ? t('events.soloFriendly') : null,
    event.smallGroup ? t('events.smallGroup') : null,
    event.mystery ? t('events.mystery') : null,
  ].filter((x): x is string => x !== null);
  const feedLines = feed ? feedDetails(t, feed) : [];
  const summary = [
    event.title,
    formatWhen(event.startsAt, i18n.language, event.timezone),
    locationLabel(t, event.location),
    capacityLabel(t, event),
    status,
    ...tags,
    ...feedLines,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={summary}
      accessibilityHint={t('a11y.opensScreen', { screen: event.title })}
      onPress={onOpen}
      testID={`event-${event.slug}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: theme.colors.surface,
          borderColor: theme.colors.border,
          borderRadius: theme.radii.lg,
          minHeight: theme.minTouchTarget,
        },
        pressed ? styles.pressed : null,
      ]}
    >
      {event.cover ? (
        <Image
          source={{ uri: event.cover.sm }}
          style={[styles.cover, { borderRadius: theme.radii.md }]}
          accessibilityIgnoresInvertColors
          // Decorative: the card / screen already reads the plan's title and details.
          accessible={false}
          importantForAccessibility="no"
        />
      ) : null}
      <View style={styles.text}>
        <Text variant="caption" tone="primary">
          {formatWhen(event.startsAt, i18n.language, event.timezone)}
        </Text>
        <Text variant="heading" numberOfLines={2}>
          {event.title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1}>
          {locationLabel(t, event.location)}
        </Text>
        <Text variant="caption" tone="muted">
          {capacityLabel(t, event)}
        </Text>
        {status ? (
          <Text variant="label" tone={event.status === 'cancelled' ? 'danger' : 'primary'}>
            {status}
          </Text>
        ) : null}
        {tags.length > 0 ? (
          <Text variant="caption" tone="muted">
            {tags.join(' · ')}
          </Text>
        ) : null}
        {feed && feed.preview.people.length > 0 ? (
          <View style={styles.faces} importantForAccessibility="no-hide-descendants">
            {feed.preview.people.map((p) => (
              <Avatar key={p.id} photo={p.photo} name={p.displayName} size={24} />
            ))}
          </View>
        ) : null}
        {feedLines.map((line) => (
          <Text key={line} variant="caption" tone="muted">
            {line}
          </Text>
        ))}
      </View>
    </Pressable>
  );
}

function feedDetails(
  t: (k: string, o?: Record<string, unknown>) => string,
  f: FeedExtras,
): string[] {
  const lines: string[] = [];
  if (f.preview.people.length > 0) {
    const names = f.preview.people.map((p) => p.displayName).join(', ');
    const more = f.preview.total - f.preview.people.length;
    lines.push(more > 0 ? `${names} ${t('discover.previewMore', { count: more })}` : names);
  }
  if (f.via) lines.push(t('discover.via', { name: f.via.displayName }));
  if (f.reasons.length > 0)
    lines.push(
      f.reasons
        .slice(0, 3)
        .map((r) => t(`discover.reasons.${r}`))
        .join(' · '),
    );
  lines.push(t('discover.distanceAway', { km: (f.distanceMeters / 1000).toFixed(1) }));
  if (f.weather?.advice) lines.push(t(`discover.advice_${f.weather.advice}`));
  return lines;
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 12, padding: 12, borderWidth: 1 },
  cover: { width: 72, height: 72 },
  text: { flex: 1, gap: 2 },
  pressed: { opacity: 0.85 },
  faces: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
