import type { EventSummary, FeedItem } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, Calendar, Check, Compass, EyeOff, Heart, Lock, People } from './icons';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { localized } from '../src/features/catalog/api';
import { capacityLabel, formatWhen, locationLabel, rsvpLabel } from '../src/features/events/format';
import { useTheme } from '../src/theme/theme';
import { Avatar } from './Avatar';
import { Icon, Pill, Text } from './ui';

type FeedExtras = Pick<FeedItem, 'preview' | 'via' | 'reasons' | 'distanceMeters' | 'weather'>;

const HERO_HEIGHT = 176;

/**
 * A plan in a list (the mock's photo-led card): cover photo with title and place over it, tags and distance on
 * top, then when, how many are pulling up, who you know that's going, and a Pull up pill. The whole card is one
 * button whose label reads every fact, so the pills and faces inside are hidden from screen readers.
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
  const womenOnly = event.visibility === 'women_only';
  const tags = [
    event.type === 'curated' ? t('share.curated') : null,
    womenOnly ? t('events.visibility.women_only') : null,
    event.soloFriendly ? t('events.soloFriendly') : null,
    event.smallGroup ? t('events.smallGroup') : null,
    event.mystery ? t('events.mystery') : null,
  ].filter((x): x is string => x !== null);
  const when = formatWhen(event.startsAt, i18n.language, event.timezone);
  const where = locationLabel(t, event.location);
  const distance = feed ? distanceLabel(t, feed.distanceMeters) : null;
  const going = t('discover.pulledUpCount', { going: event.goingCount, capacity: event.capacity });
  const faces = feed?.preview.people ?? [];
  // "Ananya & Kabir +4 more pulling up": the names you know, then how many others.
  const more = feed ? feed.preview.total - Math.min(faces.length, 2) : 0;
  const pullingUp =
    faces.length > 0
      ? t('discover.pullingUp', {
          names: [
            faces
              .slice(0, 2)
              .map((p) => p.displayName)
              .join(' & '),
            more > 0 ? t('discover.previewMore', { count: more }) : null,
          ]
            .filter(Boolean)
            .join(' '),
        })
      : null;
  const extras = feed ? feedDetails(t, feed) : [];
  const summary = [
    event.title,
    when,
    where,
    capacityLabel(t, event),
    status,
    ...tags,
    pullingUp,
    distance,
    ...extras,
  ]
    .filter(Boolean)
    .join(', ');
  const isGoing = event.viewer.rsvp === 'going';
  const cta = isGoing ? t('events.youreGoing') : t('events.pullUp');
  const ctaBg = isGoing
    ? theme.colors.surfaceAlt
    : womenOnly
      ? theme.colors.accent
      : theme.colors.primary;
  const ctaFg = isGoing
    ? theme.colors.primary
    : womenOnly
      ? theme.colors.onAccent
      : theme.colors.onPrimary;
  const lead = womenOnly
    ? { label: t('events.visibility.women_only'), tone: 'accent' as const, icon: Heart }
    : event.type === 'curated'
      ? { label: t('share.curated'), tone: 'primary' as const, icon: undefined }
      : event.category
        ? {
            label: localized(event.category.name, i18n.language),
            tone: 'primary' as const,
            icon: undefined,
          }
        : null;
  const second = event.soloFriendly
    ? t('events.soloFriendly')
    : event.smallGroup
      ? t('events.smallGroup')
      : null;

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
          borderColor: event.mystery ? theme.colors.primary : theme.colors.border,
          borderRadius: theme.radii.lg,
        },
        pressed && !theme.reduceMotion ? styles.pressed : null,
      ]}
    >
      <View
        style={styles.hero}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        {event.mystery ? (
          <LinearGradient
            colors={['#052E1C', '#0F172A', '#000000']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
        ) : event.cover ? (
          <>
            <Image
              source={{ uri: event.cover.md }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              accessibilityIgnoresInvertColors
              // Decorative: the card's label already reads the plan's title and details.
              accessible={false}
              importantForAccessibility="no"
            />
            <LinearGradient
              colors={['rgba(0,0,0,0.45)', 'rgba(0,0,0,0)', theme.colors.surface]}
              locations={[0, 0.4, 1]}
              style={StyleSheet.absoluteFill}
            />
          </>
        ) : (
          <LinearGradient
            colors={[theme.colors.surfaceAlt, theme.colors.surface]}
            style={[StyleSheet.absoluteFill, styles.placeholder]}
          >
            <Icon icon={Compass} size={52} color={theme.colors.textMuted} strokeWidth={1.4} />
          </LinearGradient>
        )}
        <View style={styles.topRow}>
          <View style={styles.pills}>
            {event.mystery ? (
              <Pill label={t('events.mystery')} tone="dark" icon={EyeOff} />
            ) : lead ? (
              <Pill label={lead.label} tone={lead.tone} icon={lead.icon} />
            ) : null}
            {second ? <Pill label={second} tone="dark" /> : null}
          </View>
          {distance ? <Pill label={distance} tone="dark" /> : null}
        </View>
        <View style={styles.heroText}>
          <Text variant="title" numberOfLines={2} style={styles.onPhoto}>
            {event.title}
          </Text>
          <Text variant="caption" numberOfLines={1} style={styles.onPhotoMuted}>
            {where}
          </Text>
        </View>
      </View>

      <View
        style={styles.body}
        importantForAccessibility="no-hide-descendants"
        accessibilityElementsHidden
      >
        <View style={styles.row}>
          <View style={[styles.row, styles.grow]}>
            <Icon icon={event.mystery ? Lock : Calendar} size={15} color={theme.colors.primary} />
            <Text variant="label" style={styles.grow}>
              {when}
            </Text>
          </View>
          <View
            style={[
              styles.count,
              { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.sm },
            ]}
          >
            <Icon icon={People} size={13} color={theme.colors.primary} />
            <Text variant="caption" style={{ color: theme.colors.primary, fontWeight: '700' }}>
              {going}
            </Text>
          </View>
        </View>
        {status && !isGoing ? (
          <Text variant="caption" tone={event.status === 'cancelled' ? 'danger' : 'primary'}>
            {status}
          </Text>
        ) : null}
        <View style={[styles.row, styles.footer, { borderTopColor: theme.colors.border }]}>
          <View style={[styles.row, styles.grow]}>
            {faces.length > 0 ? (
              <View style={styles.faces}>
                {faces.slice(0, 3).map((p, i) => (
                  <View key={p.id} style={i > 0 ? styles.overlap : null}>
                    <Avatar
                      photo={p.photo}
                      name={p.displayName}
                      size={26}
                      ring={theme.colors.background}
                    />
                  </View>
                ))}
              </View>
            ) : null}
            <Text variant="caption" tone="muted" numberOfLines={2} style={styles.grow}>
              {pullingUp ?? extras[0] ?? capacityLabel(t, event)}
            </Text>
          </View>
          <View style={[styles.cta, { backgroundColor: ctaBg, borderRadius: theme.radii.md }]}>
            <Text variant="label" style={{ color: ctaFg, fontWeight: '700' }}>
              {cta}
            </Text>
            <Icon icon={isGoing ? Check : ArrowRight} size={15} color={ctaFg} strokeWidth={2.5} />
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function distanceLabel(
  t: (k: string, o?: Record<string, unknown>) => string,
  meters: number,
): string {
  return meters < 1000
    ? t('discover.metersAway', { m: Math.max(50, Math.round(meters / 50) * 50) })
    : t('discover.distanceAway', { km: (meters / 1000).toFixed(1) });
}

function feedDetails(
  t: (k: string, o?: Record<string, unknown>) => string,
  f: FeedExtras,
): string[] {
  const lines: string[] = [];
  if (f.via) lines.push(t('discover.via', { name: f.via.displayName }));
  if (f.reasons.length > 0)
    lines.push(
      f.reasons
        .slice(0, 3)
        .map((r) => t(`discover.reasons.${r}`))
        .join(' · '),
    );
  if (f.weather?.advice) lines.push(t(`discover.advice_${f.weather.advice}`));
  return lines;
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, overflow: 'hidden' },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  hero: { height: HERO_HEIGHT, justifyContent: 'space-between', padding: 12 },
  placeholder: { alignItems: 'center', justifyContent: 'center' },

  topRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, flexShrink: 1 },
  heroText: { gap: 2 },
  onPhoto: { color: '#FFFFFF', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 8 },
  onPhotoMuted: { color: '#E5E7EB', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 6 },
  body: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grow: { flexGrow: 1, flexShrink: 1 },
  count: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10 },
  faces: { flexDirection: 'row' },
  overlap: { marginLeft: -9 },
  cta: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
});
