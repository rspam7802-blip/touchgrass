import type { StoryTrayEntry } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFlag } from '../../src/features/app-config/use-flag';
import { useStoryTray } from '../../src/features/stories/api';
import { useTheme } from '../../src/theme/theme';
import { Avatar } from '../Avatar';
import { Plus } from '../icons';
import { Icon, Text } from '../ui';

const SIZE = 52;

/**
 * Squad stories (Phase 13) as the mock's reel: "Your story" first (add one, or open yours), then people with
 * something new (lime ring), then the rest (muted ring). Hidden while the feature is switched off.
 */
export function StoryTray() {
  const { t } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const enabled = useFlag('stories');
  const q = useStoryTray(enabled);
  if (!enabled || !q.data) return null;
  const mine = q.data.items.find((i) => i.mine);
  const others = q.data.items.filter((i) => !i.mine);

  const open = (entry: StoryTrayEntry): void => {
    router.push({ pathname: '/stories/[userId]', params: { userId: entry.person.id } });
  };

  return (
    <View testID="story-tray">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <View style={styles.person}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={mine ? t('stories.yours') : t('stories.add')}
            accessibilityHint={mine ? undefined : t('stories.addHint')}
            onPress={() => {
              if (mine) open(mine);
              else router.push('/stories/new');
            }}
            testID={mine ? 'story-mine' : 'story-add'}
            style={styles.ringWrap}
          >
            {mine ? (
              <Avatar
                photo={mine.person.photo}
                name={mine.person.displayName}
                size={SIZE}
                ring={theme.colors.primary}
              />
            ) : (
              <View
                style={[
                  styles.add,
                  { borderColor: theme.colors.primary, backgroundColor: theme.colors.surfaceAlt },
                ]}
              >
                <Icon icon={Plus} size={22} color={theme.colors.primary} strokeWidth={2.4} />
              </View>
            )}
          </Pressable>
          {mine ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('stories.add')}
              onPress={() => {
                router.push('/stories/new');
              }}
              testID="story-add-more"
              hitSlop={10}
              style={[
                styles.badge,
                { backgroundColor: theme.colors.primary, borderColor: theme.colors.background },
              ]}
            >
              <Icon icon={Plus} size={14} color={theme.colors.onPrimary} strokeWidth={2.6} />
            </Pressable>
          ) : null}
          <Text variant="caption" tone="muted" numberOfLines={1} style={styles.name}>
            {t('stories.yours')}
          </Text>
        </View>
        {others.map((entry) => (
          <Pressable
            key={entry.person.id}
            accessibilityRole="button"
            accessibilityLabel={
              entry.unseen
                ? t('stories.personNew', { name: entry.person.displayName })
                : t('stories.personSeen', { name: entry.person.displayName })
            }
            onPress={() => {
              open(entry);
            }}
            testID={`story-person-${entry.person.id}`}
            style={styles.person}
          >
            <Avatar
              photo={entry.person.photo}
              name={entry.person.displayName}
              size={SIZE}
              ring={entry.unseen ? theme.colors.primary : theme.colors.border}
            />
            <Text
              variant="caption"
              numberOfLines={1}
              tone={entry.unseen ? undefined : 'muted'}
              style={[styles.name, entry.unseen ? styles.bold : null]}
            >
              {entry.person.displayName}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 18, alignItems: 'flex-start', paddingVertical: 2 },
  person: { alignItems: 'center', gap: 4, width: 62, minHeight: 44 },
  ringWrap: { minWidth: 44, minHeight: 44 },
  add: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 2,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: SIZE - 22,
    right: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: { textAlign: 'center', width: 62 },
  bold: { fontWeight: '700' },
});
