import { badgeIcon } from '../../src/features/gamification/badge-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { EmptyState, ErrorState, Icon, LoadingState, Screen, Text } from '../../components/ui';
import { localized } from '../../src/features/catalog/api';
import { useBadges } from '../../src/features/engagement/api';
import { errorMessage } from '../../src/lib/errors';
import { useTheme } from '../../src/theme/theme';

/** Badges (F-GAM-01): earned ones first, then progress towards the rest. */
export default function BadgesScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const q = useBadges();
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const items = [...q.data.items].sort(
    (a, b) => Number(b.earnedAt !== null) - Number(a.earnedAt !== null),
  );
  const earned = items.filter((b) => b.earnedAt).length;
  return (
    <Screen testID="badges-screen">
      <Text tone="muted">{t('badges.earnedCount', { count: earned })}</Text>
      {earned === 0 ? <EmptyState title={t('badges.empty')} /> : null}
      <View style={styles.grid}>
        {items.map((b) => {
          const name = localized(b.name, i18n.language);
          const status = b.earnedAt ? t('badges.earned') : t('badges.progress', b.progress);
          return (
            <View
              key={b.key}
              accessible
              accessibilityLabel={`${name}, ${localized(b.description, i18n.language)}, ${status}`}
              style={[
                styles.badge,
                {
                  borderRadius: theme.radii.md,
                  backgroundColor: b.earnedAt ? theme.colors.surfaceAlt : theme.colors.surface,
                  borderColor: theme.colors.border,
                  opacity: b.earnedAt ? 1 : 0.7,
                },
              ]}
              testID={`badge-${b.key}`}
            >
              <Icon
                icon={badgeIcon(b.key)}
                size={32}
                color={b.earnedAt ? theme.colors.primary : theme.colors.textMuted}
                strokeWidth={1.8}
              />
              <Text variant="label">{name}</Text>
              <Text variant="caption" tone="muted">
                {localized(b.description, i18n.language)}
              </Text>
              <Text variant="caption" tone={b.earnedAt ? 'primary' : 'muted'}>
                {status}
              </Text>
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  badge: { width: '47%', padding: 12, gap: 4, borderWidth: 1 },
});
