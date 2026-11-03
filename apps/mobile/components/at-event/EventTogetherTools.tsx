import type { EventDetail } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { useEventChat } from '../../src/features/chat/api';
import { useRealtime } from '../../src/features/chat/realtime';
import { Button, Text } from '../ui';

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
  const chat = useEventChat(event.id, member && event.status !== 'draft');
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
      {chat.data ? <EventChatButton id={chat.data.id} unread={chat.data.unreadCount} /> : null}
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

function EventChatButton({ id, unread }: { id: string; unread: number }) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <Button
      label={
        unread > 0
          ? `${t('chat.eventChat')} · ${t('chat.unread', { count: unread })}`
          : t('chat.eventChat')
      }
      onPress={() => {
        router.push({ pathname: '/chats/[id]', params: { id } });
      }}
      testID="open-event-chat"
    />
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, marginTop: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flexGrow: 1 },
});
