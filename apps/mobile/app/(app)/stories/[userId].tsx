import { useQueryClient } from '@tanstack/react-query';
import type { Story } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '../../../components/Avatar';
import { Eye, Flag, Heart, Pause, Play, Send, Trash, X } from '../../../components/icons';
import {
  Button,
  ErrorState,
  FadeIn,
  Icon,
  IconButton,
  LoadingState,
  OfflineState,
  Pop,
  Text,
} from '../../../components/ui';
import { useStartDirect } from '../../../src/features/chat/api';
import { formatTime } from '../../../src/features/events/format';
import {
  STORY_KEYS,
  useDeleteStory,
  useLikeStory,
  useMarkStoryViewed,
  usePersonStories,
  useStoryViewers,
} from '../../../src/features/stories/api';
import { useIsOffline } from '../../../src/hooks/use-is-offline';
import { useScreenReader } from '../../../src/hooks/use-screen-reader';
import { ApiError } from '../../../src/lib/api-client';
import { errorMessage } from '../../../src/lib/errors';
import { useTheme } from '../../../src/theme/theme';

/** How long a story stays up before the next one, unless paused (or a screen reader is on). */
export const STORY_DURATION_MS = 6000;

/**
 * One person's stories, full screen (Phase 13): progress bars, tap the sides to move, like, reply by DM and
 * report. On your own: who saw it (and liked it) and delete. Moves on by itself unless paused or a screen
 * reader is on.
 */
export default function StoryViewerScreen() {
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const qc = useQueryClient();
  const offline = useIsOffline();
  const screenReader = useScreenReader();
  const q = usePersonStories(userId);
  const markViewed = useMarkStoryViewed();
  const like = useLikeStory(userId);
  const remove = useDeleteStory(userId);
  const startDirect = useStartDirect();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [viewersOpen, setViewersOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const items = q.data?.items ?? [];
  const current = Math.min(index, Math.max(items.length - 1, 0));
  const story: Story | undefined = items[current];

  const close = (): void => {
    void qc.invalidateQueries({ queryKey: STORY_KEYS.tray });
    router.back();
  };
  const next = (): void => {
    if (current + 1 < items.length) setIndex(current + 1);
    else close();
  };
  const previous = (): void => {
    setIndex(Math.max(current - 1, 0));
  };

  // Marked this visit: going back to a story must not record it again before the list refreshes.
  const marked = useRef(new Set<string>());
  const storyId = story?.id;
  const shouldMark = story !== undefined && !story.mine && !story.seen;
  useEffect(() => {
    if (storyId && shouldMark && !marked.current.has(storyId)) {
      marked.current.add(storyId);
      markViewed.mutate(storyId);
    }
    // Mark each story once as it comes on screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  const moving = storyId !== undefined && !paused && !screenReader && !viewersOpen;
  useEffect(() => {
    if (!moving) return undefined;
    const timer = setTimeout(next, STORY_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
    // Restart the clock whenever the story changes or the viewer pauses.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId, moving]);

  if (q.isPending) return offline ? <OfflineState /> : <LoadingState />;
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.status === 404;
    return gone ? (
      <SafeAreaView
        style={[styles.root, styles.center, { backgroundColor: theme.colors.background }]}
      >
        <Text tone="muted" testID="story-gone">
          {t('stories.gone')}
        </Text>
        <Button label={t('common.done')} onPress={close} testID="story-gone-close" />
      </SafeAreaView>
    ) : (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  }
  if (!story) return <LoadingState />;
  const person = q.data.person;

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      testID="story-viewer"
    >
      <View
        style={styles.bars}
        accessible
        accessibilityLabel={t('stories.progress', { index: current + 1, count: items.length })}
        testID="story-progress"
      >
        {items.map((s, i) => (
          <ProgressBar
            key={s.id}
            state={i < current ? 'done' : i > current ? 'todo' : moving ? 'playing' : 'held'}
          />
        ))}
      </View>

      <View style={styles.header}>
        <Avatar photo={person.photo} name={person.displayName} size={36} />
        <View style={styles.headerText}>
          <Text variant="label" numberOfLines={1} accessibilityRole="header">
            {person.displayName}
          </Text>
          <Text variant="caption" tone="muted">
            {t('stories.expiresAt', { time: formatTime(story.expiresAt, i18n.language) })}
          </Text>
        </View>
        <IconButton
          icon={<Icon icon={paused ? Play : Pause} size={18} />}
          label={paused ? t('stories.resume') : t('stories.pause')}
          onPress={() => {
            setPaused((p) => !p);
          }}
          testID="story-pause"
        />
        <IconButton
          icon={<Icon icon={X} size={18} />}
          label={t('stories.close')}
          onPress={close}
          testID="story-close"
        />
      </View>

      <View style={styles.stage}>
        <FadeIn key={story.id} distance={0} style={styles.image}>
          <Image
            source={{ uri: story.image.lg }}
            style={[styles.image, { borderRadius: theme.radii.md }]}
            contentFit="contain"
            accessibilityIgnoresInvertColors
            accessibilityLabel={t('stories.personSeen', { name: person.displayName })}
            testID="story-image"
          />
        </FadeIn>
        <View style={styles.taps}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('stories.previous')}
            onPress={previous}
            style={styles.tap}
            testID="story-previous"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('stories.next')}
            onPress={next}
            style={styles.tap}
            testID="story-next"
          />
        </View>
      </View>

      {story.caption ? (
        <Text style={styles.caption} testID="story-caption-text">
          {story.caption}
        </Text>
      ) : null}
      {story.held ? (
        <Text tone="muted" variant="caption" style={styles.caption} testID="story-held">
          {t('stories.held')}
        </Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityRole="alert" style={styles.caption} testID="story-error">
          {error}
        </Text>
      ) : null}

      {story.mine ? (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${t('stories.seenBy', { count: story.viewCount ?? 0 })}, ${t('stories.likes', { count: story.likeCount ?? 0 })}`}
            onPress={() => {
              setViewersOpen(true);
            }}
            style={[styles.stats, { minHeight: theme.minTouchTarget }]}
            testID="story-stats"
          >
            <Icon icon={Eye} size={18} />
            <Text variant="label">{t('stories.seenBy', { count: story.viewCount ?? 0 })}</Text>
            <Text variant="caption" tone="muted">
              {t('stories.likes', { count: story.likeCount ?? 0 })}
            </Text>
          </Pressable>
          <IconButton
            icon={<Icon icon={Trash} size={18} color={theme.colors.danger} />}
            label={t('stories.delete')}
            onPress={() =>
              void run(async () => {
                await remove.mutateAsync(story.id);
                if (items.length <= 1) close();
              })
            }
            testID="story-delete"
          />
        </View>
      ) : (
        <View style={styles.actions}>
          <IconButton
            icon={
              <Pop trigger={story.liked} when={story.liked}>
                <Icon
                  icon={Heart}
                  size={20}
                  filled={story.liked}
                  color={story.liked ? theme.colors.primary : theme.colors.text}
                />
              </Pop>
            }
            label={story.liked ? t('stories.unlike') : t('stories.like')}
            onPress={() =>
              void run(() => like.mutateAsync({ storyId: story.id, liked: !story.liked }))
            }
            testID="story-like"
          />
          <IconButton
            icon={<Icon icon={Send} size={18} />}
            label={t('stories.reply')}
            onPress={() =>
              void run(async () => {
                const chat = await startDirect.mutateAsync(person.id);
                router.replace({ pathname: '/chats/[id]', params: { id: chat.id } });
              })
            }
            testID="story-reply"
          />
          <IconButton
            icon={<Icon icon={Flag} size={18} />}
            label={t('stories.report')}
            onPress={() => {
              setPaused(true);
              router.push({
                pathname: '/report',
                params: { targetType: 'story', targetId: story.id, name: person.displayName },
              });
            }}
            testID="story-report"
          />
        </View>
      )}

      {story.mine ? (
        <ViewersSheet
          storyId={viewersOpen ? story.id : null}
          onClose={() => {
            setViewersOpen(false);
          }}
        />
      ) : null}
    </SafeAreaView>
  );
}

/**
 * One segment of the progress bar: the current story fills over its duration while playing and holds
 * when paused; seen ones are full, later ones empty. No fill animation with Reduce Motion.
 */
function ProgressBar({ state }: { state: 'done' | 'todo' | 'playing' | 'held' }) {
  const theme = useTheme();
  const fill = useRef(new Animated.Value(state === 'done' ? 1 : 0)).current;
  useEffect(() => {
    if (state === 'done' || state === 'todo') {
      fill.setValue(state === 'done' ? 1 : 0);
      return undefined;
    }
    if (theme.reduceMotion) {
      fill.setValue(1);
      return undefined;
    }
    if (state === 'held') return undefined;
    fill.setValue(0);
    const anim = Animated.timing(fill, {
      toValue: 1,
      duration: STORY_DURATION_MS,
      easing: (x: number) => x,
      useNativeDriver: false,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [state, fill, theme.reduceMotion]);
  return (
    <View style={[styles.bar, { backgroundColor: theme.colors.border }]}>
      <Animated.View
        style={[
          styles.barFill,
          {
            backgroundColor: theme.colors.primary,
            width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          },
        ]}
      />
    </View>
  );
}

/** Author only: who opened the story and who liked it. */
function ViewersSheet({ storyId, onClose }: { storyId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const q = useStoryViewers(storyId);
  const viewers = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <Modal visible={storyId !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.sheetWrap}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          onPress={onClose}
          style={styles.backdrop}
          testID="story-viewers-backdrop"
        />
        <View
          style={[
            styles.sheet,
            { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
          ]}
          testID="story-viewers"
        >
          <Text variant="heading" accessibilityRole="header">
            {t('stories.viewersTitle')}
          </Text>
          {q.isPending ? (
            <LoadingState />
          ) : q.isError ? (
            <ErrorState
              message={errorMessage(t, q.error) ?? undefined}
              onRetry={() => void q.refetch()}
            />
          ) : viewers.length === 0 ? (
            <Text tone="muted" testID="story-viewers-empty">
              {t('stories.noViewers')}
            </Text>
          ) : (
            <ScrollView contentContainerStyle={styles.viewerList}>
              {viewers.map((v) => (
                <View
                  key={v.person.id}
                  style={styles.viewerRow}
                  accessible
                  accessibilityLabel={
                    v.liked
                      ? `${v.person.displayName}, ${t('stories.likedIt')}`
                      : v.person.displayName
                  }
                  testID={`story-viewer-${v.person.id}`}
                >
                  <Avatar photo={v.person.photo} name={v.person.displayName} size={36} />
                  <Text style={styles.viewerName} numberOfLines={1}>
                    {v.person.displayName}
                  </Text>
                  {v.liked ? (
                    <Icon icon={Heart} size={16} filled color={theme.colors.primary} />
                  ) : null}
                </View>
              ))}
              {q.hasNextPage ? (
                <Button
                  label={t('stories.more')}
                  variant="ghost"
                  loading={q.isFetchingNextPage}
                  onPress={() => void q.fetchNextPage()}
                  testID="story-viewers-more"
                />
              ) : null}
            </ScrollView>
          )}
          <Button label={t('common.done')} variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 12, gap: 10 },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  bars: { flexDirection: 'row', gap: 4, paddingTop: 8 },
  bar: { flex: 1, height: 3, borderRadius: 2, overflow: 'hidden' },
  barFill: { height: 3 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerText: { flex: 1, gap: 2 },
  stage: { flex: 1 },
  image: { flex: 1, width: '100%' },
  taps: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  tap: { flex: 1 },
  caption: { textAlign: 'center' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    gap: 12,
    paddingBottom: 8,
  },
  stats: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    maxHeight: '70%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  viewerList: { gap: 10 },
  viewerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  viewerName: { flex: 1 },
});
