import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useFreeNow, useSetFree } from '../../src/features/engagement/api';
import { formatTime } from '../../src/features/events/format';
import { useTheme } from '../../src/theme/theme';
import { Avatar } from '../Avatar';
import { Button, Text } from '../ui';
import { useFlag } from '../../src/features/app-config/use-flag';

/** "I'm free now" (F-ENG-01): your own status and the squad members free right now. */
export function FreeNowStrip() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const q = useFreeNow();
  const set = useSetFree();
  const enabled = useFlag('free_now');
  if (!q.data || !enabled) return null;
  const { me, items } = q.data;
  return (
    <View style={styles.wrap} testID="free-now">
      <View style={styles.header}>
        <Text variant="heading" accessibilityRole="header">
          {t('free.title')}
        </Text>
        {me.until ? (
          <Button
            label={t('free.clear')}
            variant="ghost"
            loading={set.isPending}
            onPress={() => void set.mutateAsync(null)}
            testID="free-clear"
          />
        ) : (
          <Button
            label={t('free.setTitle')}
            variant="secondary"
            onPress={() => {
              router.push('/free');
            }}
            testID="free-set"
          />
        )}
      </View>
      {me.until ? (
        <Text tone="primary" testID="free-me">
          {t('free.youAreFree', { time: formatTime(me.until, i18n.language) })}
        </Text>
      ) : null}
      {items.length === 0 ? (
        <Text tone="muted">{t('free.nobody')}</Text>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.row}
        >
          {items.map((f) => (
            <View
              key={f.person.id}
              style={[
                styles.card,
                { borderColor: theme.colors.border, borderRadius: theme.radii.md },
              ]}
              testID={`free-${f.person.id}`}
            >
              <View
                accessible
                accessibilityLabel={[
                  f.person.displayName,
                  t('free.until', { time: formatTime(f.until, i18n.language) }),
                  f.note,
                ]
                  .filter(Boolean)
                  .join(', ')}
              >
                <Avatar photo={f.person.photo} name={f.person.displayName} />
                <Text variant="label">{f.person.displayName}</Text>
                <Text variant="caption" tone="muted">
                  {t('free.until', { time: formatTime(f.until, i18n.language) })}
                </Text>
                {f.note ? <Text variant="caption">{f.note}</Text> : null}
              </View>
              <Button
                label={t('free.planWith', { name: f.person.displayName })}
                variant="secondary"
                onPress={() => {
                  router.push({ pathname: '/plot', params: { inviteUserId: f.person.id } });
                }}
                testID={`plan-with-${f.person.id}`}
              />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  row: { gap: 12 },
  card: { borderWidth: 1, padding: 12, gap: 6, width: 200 },
});
