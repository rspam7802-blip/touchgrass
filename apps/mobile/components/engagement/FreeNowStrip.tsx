import type { FreeNowItem } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFreeNow, useSetFree } from '../../src/features/engagement/api';
import { formatTime } from '../../src/features/events/format';
import { useTheme } from '../../src/theme/theme';
import { Avatar } from '../Avatar';
import { Plus, Zap } from '../icons';
import { Button, Icon, Text } from '../ui';
import { FreeNowSheet } from './FreeNowSheet';
import { useFlag } from '../../src/features/app-config/use-flag';

const SIZE = 46;

/**
 * "I'm free now" (F-ENG-01) as the mock's radar: a dashed "+" to say you're free, then squad members free right
 * now as lime-ringed faces; tapping one starts a plan with them.
 */
export function FreeNowStrip() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const q = useFreeNow();
  const set = useSetFree();
  const enabled = useFlag('free_now');
  const [selected, setSelected] = useState<FreeNowItem | null>(null);
  if (!q.data || !enabled) return null;
  const { me, items } = q.data;
  return (
    <View style={styles.wrap} testID="free-now">
      <View style={styles.header}>
        <View style={styles.title}>
          <Icon icon={Zap} size={13} color={theme.colors.primary} strokeWidth={2.4} />
          <Text variant="overline" tone="muted" accessibilityRole="header" style={styles.upper}>
            {t('free.title')}
          </Text>
        </View>
        {me.until ? (
          <Button
            label={t('free.clear')}
            variant="ghost"
            loading={set.isPending}
            onPress={() => void set.mutateAsync(null)}
            testID="free-clear"
          />
        ) : null}
      </View>
      {me.until ? (
        <Text variant="caption" tone="primary" testID="free-me">
          {t('free.youAreFree', { time: formatTime(me.until, i18n.language) })}
        </Text>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {me.until ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('free.setTitle')}
            accessibilityHint={t('a11y.opensScreen', { screen: t('free.setTitle') })}
            onPress={() => {
              router.push('/free');
            }}
            testID="free-set"
            style={styles.person}
          >
            <View
              style={[
                styles.add,
                { borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceAlt },
              ]}
            >
              <Icon icon={Plus} size={22} color={theme.colors.primary} strokeWidth={2.4} />
            </View>
            <Text variant="caption" tone="muted" numberOfLines={1} style={styles.name}>
              {t('free.setTitle')}
            </Text>
          </Pressable>
        )}
        {items.map((f) => (
          <View key={f.person.id} testID={`free-${f.person.id}`}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={f.person.displayName}
              accessibilityHint={t('a11y.opensScreen', { screen: f.person.displayName })}
              // Read after the name: until when they're free, and their note.
              accessibilityValue={{
                text: [t('free.until', { time: formatTime(f.until, i18n.language) }), f.note]
                  .filter(Boolean)
                  .join(', '),
              }}
              onPress={() => {
                setSelected(f);
              }}
              testID={`free-person-${f.person.id}`}
              style={styles.person}
            >
              <Avatar
                photo={f.person.photo}
                name={f.person.displayName}
                size={SIZE}
                ring={theme.colors.primary}
              />
              <Text
                variant="caption"
                numberOfLines={1}
                style={[styles.name, { fontWeight: '700' }]}
              >
                {f.person.displayName}
              </Text>
              {f.note ? (
                <Text variant="caption" tone="muted" numberOfLines={1} style={styles.name}>
                  {f.note}
                </Text>
              ) : null}
            </Pressable>
          </View>
        ))}
        {items.length === 0 ? (
          <Text tone="muted" style={styles.nobody}>
            {t('free.nobody')}
          </Text>
        ) : null}
      </ScrollView>
      <FreeNowSheet
        item={selected}
        onClose={() => {
          setSelected(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  upper: { textTransform: 'uppercase' },
  title: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  row: { gap: 18, alignItems: 'flex-start', paddingVertical: 2 },
  person: { alignItems: 'center', gap: 4, width: 64, minHeight: 44 },
  add: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { textAlign: 'center', width: 64 },
  nobody: { alignSelf: 'center', maxWidth: 220 },
});
