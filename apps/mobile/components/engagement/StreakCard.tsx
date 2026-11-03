import { Check, Flame, Snowflake } from '../icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useStreak } from '../../src/features/engagement/api';
import { useTheme } from '../../src/theme/theme';
import { Icon, Text } from '../ui';

/** Weekly outside streak (F-GAM-02): current and best, this week's state, the last eight weeks as text too. */
export function StreakCard() {
  const { t } = useTranslation();
  const theme = useTheme();
  const q = useStreak();
  if (!q.data) return null;
  const s = q.data;
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.colors.surfaceAlt, borderRadius: theme.radii.md },
      ]}
      testID="streak-card"
    >
      <Text variant="heading" accessibilityRole="header">
        {t('streak.title')}
      </Text>
      {s.current === 0 && s.longest === 0 ? (
        <Text tone="muted">{t('streak.none')}</Text>
      ) : (
        <>
          <View style={styles.current}>
            <Icon icon={Flame} size={24} color={theme.colors.primary} />
            <Text variant="title" testID="streak-current">
              {t('streak.weeks', { count: s.current })}
            </Text>
          </View>
          <Text tone="muted">{t('streak.longest', { count: s.longest })}</Text>
        </>
      )}
      {s.thisWeek ? (
        <Text tone="primary">{t('streak.thisWeekDone')}</Text>
      ) : s.atRisk ? (
        <Text tone="danger" testID="streak-at-risk">
          {t('streak.atRisk')}
        </Text>
      ) : null}
      <Text variant="caption" tone="muted">
        {s.freezeAvailable ? t('streak.freezeAvailable') : t('streak.freezeUsed')}
      </Text>
      <View
        style={styles.weeks}
        accessible
        accessibilityLabel={s.recentWeeks.map((w) => t(`streak.week.${w.state}`)).join(', ')}
      >
        {s.recentWeeks.map((w) => (
          <View
            key={w.week}
            style={[
              styles.dot,
              {
                backgroundColor:
                  w.state === 'out'
                    ? theme.colors.primary
                    : w.state === 'freeze'
                      ? theme.colors.accent
                      : theme.colors.border,
              },
            ]}
          >
            {w.state === 'out' ? (
              <Icon icon={Check} size={14} color={theme.colors.onPrimary} strokeWidth={2.6} />
            ) : w.state === 'freeze' ? (
              <Icon icon={Snowflake} size={14} color={theme.colors.onPrimary} />
            ) : (
              <Text variant="caption">·</Text>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  current: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { padding: 16, gap: 6 },
  weeks: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  dot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
