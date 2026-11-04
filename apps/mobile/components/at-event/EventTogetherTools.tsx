import type { EventDetail } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import type { Message } from '@touchgrass/shared';
import { flatten } from '../../src/features/social/api';
import { useEventChat, useMessages } from '../../src/features/chat/api';
import { useRealtime } from '../../src/features/chat/realtime';
import { Button, Card, Text } from '../ui';

/**
 * Plan chat and at-the-plan tools (F-CHT-02, F-ATE-01..03) for people holding a seat and hosts. While the plan is
 * open on screen the app listens for icebreakers the host pushes.
 */
export function EventTogetherTools({ event }: { event: EventDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const v = event.viewer;
  const member = v.isHost || v.rsvp === 'going' || v.rsvp === 'checked_in';
  const live = event.status === 'published';
  const chat = useEventChat(event.id, member && event.chatEnabled && event.status !== 'draft');
  const socket = useRealtime((s) => s.events);

  useEffect(() => {
    if (!socket || !member || !live) return;
    const join = (): void => {
      socket.emit('event:join', { eventId: event.id }, () => undefined);
    };
    join();
    socket.on('connect', join);
    return () => {
      socket.off('connect', join);
    };
  }, [socket, member, live, event.id]);

  if (!member) return null;
  const go = (
    pathname: '/events/[id]/icebreakers' | '/events/[id]/signal' | '/events/[id]/newcomers',
  ): void => {
    router.push({ pathname, params: { id: event.id } });
  };
  return (
    <View style={styles.wrap} testID="together-tools">
      <Text variant="heading" accessibilityRole="header">
        {t('chat.eventChat')}
      </Text>
      {!event.chatEnabled ? (
        <Text tone="muted" testID="event-chat-off">
          {t('events.chatOff')}
        </Text>
      ) : null}
      {chat.data ? (
        <Card testID="event-chat-preview">
          <ChatPreview id={chat.data.id} />
          <EventChatButton id={chat.data.id} unread={chat.data.unreadCount} />
        </Card>
      ) : null}
      {live ? (
        <View style={styles.row}>
          <Button
            label={t('ate.icebreakers')}
            variant="secondary"
            onPress={() => {
              go('/events/[id]/icebreakers');
            }}
            style={styles.grow}
            testID="open-icebreakers"
          />
          <Button
            label={t('ate.signalTitle')}
            variant="secondary"
            onPress={() => {
              go('/events/[id]/signal');
            }}
            style={styles.grow}
            testID="open-signal"
          />
          {v.isHost ? (
            <Button
              label={t('ate.newcomers')}
              variant="secondary"
              onPress={() => {
                go('/events/[id]/newcomers');
              }}
              style={styles.grow}
              testID="open-newcomers"
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const PREVIEW_COUNT = 3;

/** The plan chat's latest messages, oldest first, so the group's conversation reads at a glance. */
function ChatPreview({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useMessages(id);
  const items = flatten(q.data)
    .filter((m) => m.kind !== 'system')
    .slice(0, PREVIEW_COUNT)
    .reverse();
  if (q.isPending) return null;
  if (items.length === 0)
    return (
      <Text tone="muted" testID="event-chat-empty">
        {t('chat.noMessagesYet')}
      </Text>
    );
  return (
    <View style={styles.preview}>
      {items.map((m) => (
        <Text key={m.id} numberOfLines={2} testID={`event-chat-line-${m.id}`}>
          <Text variant="label">
            {m.mine ? t('chat.you') : (m.sender?.displayName ?? t('chat.someone'))}
          </Text>
          {`  ${previewText(t, m)}`}
        </Text>
      ))}
    </View>
  );
}

function previewText(t: (k: string, o?: Record<string, unknown>) => string, m: Message): string {
  if (m.deleted) return t('chat.deleted');
  if (m.poll) return m.poll.question;
  if (m.image && !m.body)
    return t('chat.photoFrom', { name: m.sender?.displayName ?? t('chat.someone') });
  return m.body ?? '';
}

function EventChatButton({ id, unread }: { id: string; unread: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Button
      label={
        unread > 0
          ? `${t('chat.openChat')} · ${t('chat.unread', { count: unread })}`
          : t('chat.openChat')
      }
      onPress={() => {
        router.push({ pathname: '/chats/[id]', params: { id } });
      }}
      testID="open-event-chat"
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flexGrow: 1 },
  preview: { gap: 6 },
});
