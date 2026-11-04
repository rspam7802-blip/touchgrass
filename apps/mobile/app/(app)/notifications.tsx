import type { NotificationItem } from '@touchgrass/shared';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import {
  Button,
  EmptyState,
  ErrorState,
  FadeIn,
  LoadingState,
  staggerDelay,
  Text,
} from '../../components/ui';
import { useTrack } from '../../src/features/analytics/analytics';
import { formatWhen } from '../../src/features/events/format';
import { useInbox, useMarkRead } from '../../src/features/notifications/api';
import { pushPath } from '../../src/features/notifications/push-links';
import { errorMessage } from '../../src/lib/errors';
import { useTheme } from '../../src/theme/theme';

/** The notification inbox (F-NOT-01): newest first, unread marked, tapping opens what it is about. */
export default function NotificationsScreen() {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const q = useInbox();
  const read = useMarkRead();
  const track = useTrack();
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const items = q.data.pages.flatMap((p) => p.items);
  const unread = q.data.pages[0]?.unread ?? 0;

  const open = (n: NotificationItem): void => {
    if (!n.read) read.mutate({ ids: [n.id] });
    track('notification_opened', { kind: n.kind, source: 'inbox' });
    const path = pushPath({ url: n.url });
    if (path) router.push(path as Href);
  };

  return (
    <View
      style={[styles.root, { backgroundColor: theme.colors.background }]}
      testID="notifications-screen"
    >
      <View style={styles.header}>
        <Text tone="muted" testID="notifications-unread">
          {t('notifications.unread', { count: unread })}
        </Text>
        {unread > 0 ? (
          <Button
            label={t('notifications.markAllRead')}
            variant="ghost"
            loading={read.isPending}
            onPress={() => {
              read.mutate({ all: true });
            }}
            testID="notifications-read-all"
          />
        ) : null}
      </View>
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={<EmptyState title={t('notifications.empty')} />}
        onEndReached={() => {
          if (q.hasNextPage && !q.isFetchingNextPage) void q.fetchNextPage();
        }}
        renderItem={({ item, index }) => (
          <FadeIn delay={staggerDelay(index, 40, 8)}>
            <Pressable
              onPress={() => {
                open(item);
              }}
              accessibilityRole="button"
              accessibilityLabel={[
                item.read ? null : t('notifications.unread', { count: 1 }),
                item.title,
                item.body,
                formatWhen(item.createdAt, i18n.language),
              ]
                .filter(Boolean)
                .join('. ')}
              style={[
                styles.item,
                {
                  borderColor: theme.colors.border,
                  backgroundColor: item.read ? theme.colors.background : theme.colors.surfaceAlt,
                  borderRadius: theme.radii.md,
                },
              ]}
              testID={`notification-${item.id}`}
            >
              <Text variant="label">
                {item.read ? '' : '● '}
                {item.title}
              </Text>
              {item.body ? <Text>{item.body}</Text> : null}
              <Text variant="caption" tone="muted">
                {formatWhen(item.createdAt, i18n.language)}
              </Text>
            </Pressable>
          </FadeIn>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  list: { padding: 16, gap: 8, flexGrow: 1 },
  item: { minHeight: 44, padding: 12, gap: 4, borderWidth: 1 },
});
