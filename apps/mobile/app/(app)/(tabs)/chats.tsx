import { BellOff } from '../../../components/icons';
import type { ConversationSummary } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import { Avatar } from '../../../components/Avatar';
import { SegmentedTabs } from '../../../components/SegmentedTabs';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  LoadingState,
  OfflineState,
  Screen,
  Text,
} from '../../../components/ui';
import { useInbox } from '../../../src/features/chat/api';
import { formatTime } from '../../../src/features/events/format';
import { flatten } from '../../../src/features/social/api';
import { useIsOffline } from '../../../src/hooks/use-is-offline';
import { errorMessage } from '../../../src/lib/errors';
import { useTheme } from '../../../src/theme/theme';

function preview(
  t: (k: string, o?: Record<string, unknown>) => string,
  c: ConversationSummary,
): string {
  const m = c.lastMessage;
  if (!m) return c.state === 'request_sent' ? t('chat.requestSent') : '';
  const text =
    m.kind === 'image'
      ? t('chat.photo')
      : m.kind === 'system'
        ? t('chat.chatOpened')
        : (m.excerpt ?? t('chat.deleted'));
  return c.kind !== 'direct' && m.senderName ? `${m.senderName}: ${text}` : text;
}

/** Chats inbox (F-CHT-04): newest first, unread counts, mute state; message requests on their own tab. */
export default function ChatsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const offline = useIsOffline();
  const [filter, setFilter] = useState<'all' | 'requests'>('all');
  const q = useInbox(filter);
  const requests = useInbox('requests');
  const requestCount = flatten(requests.data).length;

  let body;
  if (q.isPending) body = <LoadingState />;
  else if (q.isError)
    body = offline ? (
      <OfflineState onRetry={() => void q.refetch()} />
    ) : (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  else {
    const items = flatten(q.data);
    body =
      items.length === 0 ? (
        <EmptyState body={filter === 'all' ? t('chat.empty') : t('chat.requestsEmpty')} />
      ) : (
        <>
          {items.map((c) => {
            const line = preview(t, c);
            const label = [
              c.title,
              line,
              c.unreadCount > 0 ? t('chat.unread', { count: c.unreadCount }) : null,
              c.muted ? t('chat.muted') : null,
            ]
              .filter(Boolean)
              .join(', ');
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityHint={t('a11y.opensScreen', { screen: c.title })}
                onPress={() => {
                  router.push({ pathname: '/chats/[id]', params: { id: c.id } });
                }}
                style={[
                  styles.row,
                  { minHeight: theme.minTouchTarget, borderBottomColor: theme.colors.border },
                ]}
                testID={`conv-${c.id}`}
              >
                <Avatar photo={c.avatar} name={c.title} />
                <View style={styles.text}>
                  <View style={styles.titleRow}>
                    <Text variant="heading" numberOfLines={1} style={styles.title}>
                      {c.title}
                    </Text>
                    {c.muted ? (
                      <Icon icon={BellOff} size={14} color={theme.colors.textMuted} />
                    ) : null}
                  </View>
                  <Text variant="caption" tone="muted" numberOfLines={1}>
                    {line}
                  </Text>
                </View>
                <View style={styles.meta}>
                  {c.lastMessage ? (
                    <Text variant="caption" tone="muted">
                      {formatTime(c.lastMessage.createdAt, i18n.language)}
                    </Text>
                  ) : null}
                  {c.unreadCount > 0 ? (
                    <View style={[styles.badge, { backgroundColor: theme.colors.primary }]}>
                      <Text variant="caption" tone="onPrimary">
                        {c.unreadCount}
                      </Text>
                    </View>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
          {q.hasNextPage ? (
            <Button
              label={t('common.seeAll')}
              variant="ghost"
              loading={q.isFetchingNextPage}
              onPress={() => void q.fetchNextPage()}
            />
          ) : null}
        </>
      );
  }

  return (
    <Screen testID="chats-screen">
      <Text variant="title" accessibilityRole="header">
        {t('chat.title')}
      </Text>
      <SegmentedTabs
        tabs={[
          { key: 'all', label: t('chat.title') },
          { key: 'requests', label: t('chat.requests'), badge: requestCount },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {body}
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { flexShrink: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  text: { flex: 1, gap: 2 },
  meta: { alignItems: 'flex-end', gap: 4 },
  badge: {
    minWidth: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
});
