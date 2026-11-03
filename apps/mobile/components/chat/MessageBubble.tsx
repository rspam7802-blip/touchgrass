import type { Message, PollView } from '@touchgrass/shared';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { localized } from '../../src/features/catalog/api';
import { formatTime } from '../../src/features/events/format';
import type { PendingMessage } from '../../src/features/chat/outbox';
import { useTheme } from '../../src/theme/theme';
import { Button, Text } from '../ui';

/** System lines (chat opened, icebreakers, request accepted) in the reader's language. */
export function systemText(
  t: (k: string, o?: Record<string, unknown>) => string,
  language: string,
  m: Message,
): string {
  const s = m.system;
  if (!s) return '';
  switch (s.type) {
    case 'chat_opened':
      return s.prompt
        ? `${t('chat.chatOpened')} ${t('chat.icebreaker', { prompt: localized(s.prompt, language) })}`
        : t('chat.chatOpened');
    case 'icebreaker':
      return t('chat.icebreaker', { prompt: localized(s.prompt, language) });
    case 'request_accepted':
      return t('chat.requestAccepted');
  }
}

export function PollCard({
  poll,
  canVote,
  canClose,
  onVote,
  onClose,
}: {
  poll: PollView;
  canVote: boolean;
  canClose: boolean;
  onVote: (optionIds: string[]) => void;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const mine = poll.options.filter((o) => o.mine).map((o) => o.id);
  const total = Math.max(
    1,
    poll.options.reduce((s, o) => s + o.votes, 0),
  );
  return (
    <View
      style={[styles.poll, { borderColor: theme.colors.border, borderRadius: theme.radii.md }]}
      testID={`poll-${poll.id}`}
    >
      <Text variant="heading">{poll.question}</Text>
      {poll.options.map((o) => {
        const selected = mine.includes(o.id);
        const label = `${o.text}, ${t('chat.pollVotes', { count: o.votes })}`;
        return (
          <Pressable
            key={o.id}
            accessibilityRole={poll.multi ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: selected, disabled: !canVote || poll.closed }}
            accessibilityLabel={label}
            disabled={!canVote || poll.closed}
            testID={`poll-option-${o.id}`}
            onPress={() => {
              if (poll.multi) onVote(selected ? mine.filter((x) => x !== o.id) : [...mine, o.id]);
              else onVote(selected ? [] : [o.id]);
            }}
            style={[
              styles.option,
              {
                minHeight: theme.minTouchTarget,
                borderColor: selected ? theme.colors.primary : theme.colors.border,
                borderRadius: theme.radii.sm,
              },
            ]}
          >
            <View
              style={[
                styles.bar,
                {
                  width: `${String(Math.round((o.votes / total) * 100))}%`,
                  backgroundColor: theme.colors.primary,
                },
              ]}
            />
            <Text>
              {selected ? '✓ ' : ''}
              {o.text}
            </Text>
            <Text variant="caption" tone="muted">
              {o.votes}
              {!poll.anonymous && o.voters.length > 0
                ? ` · ${o.voters.map((v) => v.displayName).join(', ')}`
                : ''}
            </Text>
          </Pressable>
        );
      })}
      <Text variant="caption" tone="muted">
        {poll.closed
          ? t('chat.pollClosed')
          : poll.closesAt
            ? t('chat.pollCloses', { time: formatTime(poll.closesAt, i18n.language) })
            : t('chat.pollVotes', { count: poll.totalVoters })}
        {poll.anonymous ? ` · ${t('chat.pollAnonymous')}` : ''}
      </Text>
      {canClose && !poll.closed ? (
        <Button
          label={t('chat.pollClosed')}
          variant="ghost"
          onPress={onClose}
          testID={`close-poll-${poll.id}`}
        />
      ) : null}
    </View>
  );
}

export interface MessageBubbleProps {
  message: Message | null;
  pending?: PendingMessage;
  group: boolean;
  seenBy: string[];
  canVote: boolean;
  canClosePoll: boolean;
  onLongPress: () => void;
  onRetry?: () => void;
  onVote: (pollId: string, optionIds: string[]) => void;
  onClosePoll: (pollId: string) => void;
}

/** One chat line. Long-press opens reply / react / delete / report; failed sends offer a retry. */
export function MessageBubble({
  message,
  pending,
  group,
  seenBy,
  canVote,
  canClosePoll,
  onLongPress,
  onRetry,
  onVote,
  onClosePoll,
}: MessageBubbleProps) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  if (message?.kind === 'system')
    return (
      <Text
        variant="caption"
        tone="muted"
        style={styles.system}
        accessibilityRole="text"
        testID={`msg-${message.id}`}
      >
        {systemText(t, i18n.language, message)}
      </Text>
    );
  const mine = message ? message.mine : true;
  const body = message
    ? message.deleted
      ? t('chat.deleted')
      : message.body
    : (pending?.body ?? (pending?.kind === 'image' ? t('chat.photo') : ''));
  const time = message ? formatTime(message.createdAt, i18n.language) : '';
  const status = pending
    ? pending.status === 'failed'
      ? t('chat.failed')
      : t('chat.sending')
    : message?.held
      ? t('moderation.heldShort')
      : null;
  const sender = group && !mine && message?.sender ? message.sender.displayName : null;
  const reactions = message?.reactions ?? [];
  const label = [
    sender,
    message?.replyTo ? t('chat.replyingTo', { name: message.replyTo.senderName ?? '' }) : null,
    body,
    time,
    status,
    ...reactions.map((r) => t('chat.reactionCount', { emoji: r.emoji, count: r.count })),
    seenBy.length > 0 ? t('chat.seenBy', { names: seenBy.join(', ') }) : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={[styles.row, mine ? styles.mineRow : null]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={pending?.status === 'failed' ? t('chat.failed') : t('chat.options')}
        onLongPress={message && !message.deleted ? onLongPress : undefined}
        onPress={pending?.status === 'failed' ? onRetry : undefined}
        testID={message ? `msg-${message.id}` : `pending-${pending?.clientId ?? ''}`}
        style={[
          styles.bubble,
          {
            backgroundColor: mine ? theme.colors.primary : theme.colors.surface,
            borderColor: theme.colors.border,
            borderRadius: theme.radii.lg,
            opacity: pending ? 0.7 : 1,
          },
        ]}
      >
        {sender ? (
          <Text variant="caption" tone={mine ? 'onPrimary' : 'primary'}>
            {sender}
          </Text>
        ) : null}
        {message?.replyTo ? (
          <View
            style={[
              styles.reply,
              { borderLeftColor: mine ? theme.colors.onPrimary : theme.colors.primary },
            ]}
          >
            <Text variant="caption" tone={mine ? 'onPrimary' : 'muted'} numberOfLines={2}>
              {message.replyTo.senderName ?? ''}: {message.replyTo.excerpt ?? t('chat.deleted')}
            </Text>
          </View>
        ) : null}
        {message?.image ? (
          <Image
            source={{ uri: message.image.md }}
            style={[styles.image, { borderRadius: theme.radii.md }]}
            accessibilityIgnoresInvertColors
            accessibilityLabel={t('chat.photoFrom', {
              name: message.sender?.displayName ?? t('chat.someone'),
            })}
          />
        ) : null}
        {message?.poll ? (
          <PollCard
            poll={message.poll}
            canVote={canVote}
            canClose={canClosePoll}
            onVote={(ids) => {
              if (message.poll) onVote(message.poll.id, ids);
            }}
            onClose={() => {
              if (message.poll) onClosePoll(message.poll.id);
            }}
          />
        ) : body ? (
          <Text
            tone={mine ? 'onPrimary' : 'default'}
            style={message?.deleted ? styles.deleted : null}
          >
            {body}
          </Text>
        ) : null}
        <Text variant="caption" tone={mine ? 'onPrimary' : 'muted'}>
          {[time, status].filter(Boolean).join(' · ')}
        </Text>
      </Pressable>
      {reactions.length > 0 ? (
        <Text variant="caption" style={styles.reactions}>
          {reactions.map((r) => `${r.emoji} ${String(r.count)}`).join('  ')}
        </Text>
      ) : null}
      {seenBy.length > 0 ? (
        <Text variant="caption" tone="muted">
          {t('chat.seenBy', { names: seenBy.join(', ') })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'flex-start', gap: 2, marginVertical: 4 },
  mineRow: { alignItems: 'flex-end' },
  bubble: { maxWidth: '85%', paddingHorizontal: 12, paddingVertical: 8, gap: 4, borderWidth: 1 },
  system: { textAlign: 'center', marginVertical: 8 },
  reply: { borderLeftWidth: 3, paddingLeft: 8 },
  image: { width: 220, height: 220 },
  deleted: { fontStyle: 'italic' },
  reactions: { paddingHorizontal: 8 },
  poll: { gap: 8, padding: 8, borderWidth: 1, minWidth: 240 },
  option: { borderWidth: 2, padding: 8, justifyContent: 'center', overflow: 'hidden' },
  bar: { position: 'absolute', left: 0, top: 0, bottom: 0, opacity: 0.15 },
});
