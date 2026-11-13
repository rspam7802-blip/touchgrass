import { LIMITS, type Message, REACTIONS } from '@touchgrass/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Photo, Send } from '../../../../components/icons';
import { fontFamilyFor } from '../../../../src/theme/fonts';
import { MessageBubble } from '../../../../components/chat/MessageBubble';
import {
  Button,
  ErrorState,
  FadeIn,
  Icon,
  LoadingState,
  OfflineBanner,
  Text,
} from '../../../../components/ui';
import {
  useClosePoll,
  useConversation,
  useDeleteMessage,
  useMarkRead,
  useMessages,
  useMute,
  useReact,
  useRespondRequest,
  useVote,
} from '../../../../src/features/chat/api';
import { useOutbox } from '../../../../src/features/chat/outbox';
import { useRealtime } from '../../../../src/features/chat/realtime';
import { useChatSender } from '../../../../src/features/chat/send';
import { formatWhen } from '../../../../src/features/events/format';
import {
  compressImage,
  pickImage,
  uploadImage,
  waitUntilReady,
} from '../../../../src/features/media/upload';
import { errorMessage } from '../../../../src/lib/errors';
import { useApi } from '../../../../src/providers/api-context';
import { useTheme } from '../../../../src/theme/theme';

const JOIN_REFRESH_MS = 60_000;
const TYPING_THROTTLE_MS = 3000;
const MEDIA_READY_POLLS = 10;

type Row = { kind: 'message'; message: Message } | { kind: 'pending'; clientId: string };

/** A conversation (F-CHT-01..05): live messages, offline queue, replies, photos, reactions, polls, receipts. */
export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { client } = useApi();
  const conv = useConversation(id);
  const msgs = useMessages(id);
  const { send, retry, flush } = useChatSender();
  // Select stable store slices and derive per-thread views here, so renders never loop on fresh objects.
  const outboxItems = useOutbox((s) => s.items);
  const pending = useMemo(
    () => outboxItems.filter((m) => m.conversationId === id),
    [outboxItems, id],
  );
  const typing = useRealtime((s) => s.typing[id]);
  const socket = useRealtime((s) => s.chat);
  const respond = useRespondRequest(id);
  const mute = useMute(id);
  const react = useReact(id);
  const del = useDeleteMessage(id);
  const markRead = useMarkRead(id);
  const vote = useVote(id);
  const closePoll = useClosePoll(id);
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [selected, setSelected] = useState<Message | null>(null);
  const [muteOpen, setMuteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const lastTyping = useRef(0);

  // Presence: while this screen is open the server knows we are looking (no push for this chat).
  useEffect(() => {
    if (!socket) return;
    const join = (): void => {
      socket.emit('chat:join', { conversationId: id }, () => undefined);
    };
    join();
    const timer = setInterval(join, JOIN_REFRESH_MS);
    return () => {
      clearInterval(timer);
      socket.emit('chat:leave', { conversationId: id });
    };
  }, [socket, id]);

  useEffect(() => {
    void flush(id);
  }, [flush, id]);

  const messages = useMemo(() => msgs.data?.pages.flatMap((p) => p.items) ?? [], [msgs.data]);
  const readBy = msgs.data?.pages[0]?.readBy ?? [];
  const latestFromOthers = messages.find((m) => !m.mine && m.kind !== 'system');

  // Read up to the newest message from someone else.
  useEffect(() => {
    if (latestFromOthers) markRead.mutate(latestFromOthers.id);
    // markRead is stable per conversation; re-run only when the newest incoming message changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestFromOthers?.id]);

  if (conv.isPending || msgs.isPending) return <LoadingState />;
  if (conv.isError)
    return (
      <ErrorState
        message={errorMessage(t, conv.error) ?? undefined}
        onRetry={() => void conv.refetch()}
      />
    );
  if (msgs.isError)
    return (
      <ErrorState
        message={errorMessage(t, msgs.error) ?? undefined}
        onRetry={() => void msgs.refetch()}
      />
    );
  const c = conv.data;
  // Every action on this screen reports failures in the same error line instead of failing silently.
  const fail = (err: unknown): void => {
    setError(errorMessage(t, err));
  };
  const group = c.kind !== 'direct';
  const canWrite = !c.readOnly;
  const names = Object.values(typing ?? {}).filter((n) => n.length > 0);

  const rows: Row[] = [
    ...[...pending].reverse().map((p) => ({ kind: 'pending' as const, clientId: p.clientId })),
    ...messages.map((m) => ({ kind: 'message' as const, message: m })),
  ];
  const seenOn = new Map<string, string[]>();
  // Direct chats show "seen" under your own messages; group receipts stay out of the bubbles.
  if (!group && c.peer)
    for (const r of readBy)
      if (r.userId === c.peer.id) seenOn.set(r.messageId, [c.peer.displayName]);

  const submit = async (): Promise<void> => {
    const body = text.trim();
    if (!body) return;
    setText('');
    setError(null);
    const reply = replyTo?.id;
    setReplyTo(null);
    await send({ conversationId: id, kind: 'text', body, replyToId: reply }).catch(
      (err: unknown) => {
        setError(errorMessage(t, err));
      },
    );
  };

  const attach = async (): Promise<void> => {
    setError(null);
    let uri: string | null;
    try {
      uri = await pickImage();
    } catch (err) {
      setError(errorMessage(t, err));
      return;
    }
    if (!uri) return;
    setUploading(true);
    try {
      const asset = await uploadImage(client, 'chat', await compressImage(uri));
      // Images are scanned before anyone else sees them; wait (briefly) for that to finish.
      if (!(await waitUntilReady(client, asset, MEDIA_READY_POLLS))) throw new Error('not ready');
      await send({ conversationId: id, kind: 'image', mediaId: asset.id });
    } catch (err) {
      setError(errorMessage(t, err));
    } finally {
      setUploading(false);
    }
  };

  const onTextChange = (v: string): void => {
    setText(v);
    const now = Date.now();
    if (socket && now - lastTyping.current > TYPING_THROTTLE_MS) {
      lastTyping.current = now;
      socket.emit('chat:typing', { conversationId: id, typing: v.length > 0 });
    }
  };

  const banner =
    c.state === 'request_received' ? (
      <View style={styles.banner} testID="request-banner">
        <Text>{t('chat.requestReceived', { name: c.title })}</Text>
        <View style={styles.row}>
          <Button
            label={t('chat.accept')}
            loading={respond.isPending}
            onPress={() => {
              setError(null);
              respond.mutateAsync(true).catch(fail);
            }}
            testID="accept-request"
          />
          <Button
            label={t('chat.decline')}
            variant="secondary"
            loading={respond.isPending}
            onPress={() => {
              setError(null);
              respond.mutateAsync(false).then(() => {
                router.back();
              }, fail);
            }}
            testID="decline-request"
          />
        </View>
      </View>
    ) : c.state === 'request_sent' ? (
      <Text tone="muted" style={styles.banner}>
        {t('chat.requestSent')}
      </Text>
    ) : c.readOnly ? (
      <Text tone="muted" style={styles.banner} testID="readonly-banner">
        {c.opensAt && new Date(c.opensAt).getTime() > Date.now()
          ? t('chat.opensAt', { time: formatWhen(c.opensAt, i18n.language) })
          : t('chat.closed')}
      </Text>
    ) : null;

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
      edges={['bottom']}
      testID="thread-screen"
    >
      {/* Keeps the message box above the keyboard (edge-to-edge Android and iOS alike). */}
      <KeyboardAvoidingView
        behavior="padding"
        keyboardVerticalOffset={insets.top + (Platform.OS === 'ios' ? 44 : 56)}
        style={styles.screen}
      >
        <OfflineBanner />
        <View style={[styles.header, { borderBottomColor: theme.colors.border }]}>
          <Text variant="heading" accessibilityRole="header" style={styles.grow} numberOfLines={1}>
            {c.title}
          </Text>
          <Button
            label={c.muted ? t('chat.unmute') : t('chat.mute')}
            variant="ghost"
            loading={mute.isPending}
            onPress={() => {
              if (c.muted) mute.mutateAsync('off').catch(fail);
              else setMuteOpen(true);
            }}
            testID="mute"
          />
          {c.canCreatePoll ? (
            <Button
              label={t('chat.newPoll')}
              variant="ghost"
              onPress={() => {
                router.push({ pathname: '/chats/[id]/poll', params: { id } });
              }}
              testID="new-poll"
            />
          ) : null}
        </View>
        {banner}
        <FlatList
          inverted
          keyboardShouldPersistTaps="handled"
          data={rows}
          keyExtractor={(r) => (r.kind === 'message' ? r.message.id : r.clientId)}
          onEndReached={() => {
            if (msgs.hasNextPage && !msgs.isFetchingNextPage) void msgs.fetchNextPage();
          }}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const p =
              item.kind === 'pending'
                ? pending.find((x) => x.clientId === item.clientId)
                : undefined;
            const m = item.kind === 'message' ? item.message : null;
            return (
              <FadeIn distance={6}>
                <MessageBubble
                  message={m}
                  pending={p}
                  group={group}
                  seenBy={m && m.mine ? (seenOn.get(m.id) ?? []).filter(Boolean) : []}
                  canVote={canWrite}
                  canClosePoll={m?.poll ? m.mine || c.canCreatePoll : false}
                  onLongPress={() => {
                    if (m) setSelected(m);
                  }}
                  onRetry={() => {
                    if (p) void retry(p);
                  }}
                  onVote={(pollId, optionIds) => {
                    vote.mutate({ pollId, optionIds });
                  }}
                  onClosePoll={(pollId) => {
                    closePoll.mutate(pollId);
                  }}
                />
              </FadeIn>
            );
          }}
        />
        {names.length > 0 ? (
          <Text
            variant="caption"
            tone="muted"
            accessibilityLiveRegion="polite"
            style={styles.typing}
            testID="typing"
          >
            {names.length === 1 ? t('chat.typing', { name: names[0] }) : t('chat.typingMany')}
          </Text>
        ) : null}
        {error ? (
          <Text
            tone="danger"
            accessibilityLiveRegion="assertive"
            style={styles.typing}
            testID="thread-error"
          >
            {error}
          </Text>
        ) : null}
        {canWrite && c.state !== 'request_received' ? (
          <View style={[styles.composer, { borderTopColor: theme.colors.border }]}>
            {replyTo ? (
              <View style={styles.row}>
                <Text variant="caption" tone="muted" style={styles.grow} numberOfLines={1}>
                  {t('chat.replyingTo', { name: replyTo.sender?.displayName ?? '' })}:{' '}
                  {replyTo.body ?? ''}
                </Text>
                <Button
                  label={t('chat.cancelReply')}
                  variant="ghost"
                  onPress={() => {
                    setReplyTo(null);
                  }}
                />
              </View>
            ) : null}
            <View style={styles.composerRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chat.attachPhoto')}
                accessibilityState={{ disabled: uploading, busy: uploading }}
                disabled={uploading}
                onPress={() => void attach()}
                testID="attach"
                style={[
                  styles.round,
                  {
                    backgroundColor: theme.colors.surfaceAlt,
                    borderColor: theme.colors.border,
                    opacity: uploading ? 0.5 : 1,
                  },
                ]}
              >
                {uploading ? (
                  <ActivityIndicator color={theme.colors.primary} />
                ) : (
                  <Icon icon={Photo} size={22} color={theme.colors.text} />
                )}
              </Pressable>
              <TextInput
                accessibilityLabel={t('chat.message')}
                placeholder={t('chat.messagePlaceholder')}
                placeholderTextColor={theme.colors.textMuted}
                value={text}
                onChangeText={onTextChange}
                maxLength={LIMITS.chat.maxMessageLength}
                multiline
                maxFontSizeMultiplier={2}
                testID="composer"
                style={[
                  theme.typography.body,
                  styles.input,
                  {
                    color: theme.colors.text,
                    backgroundColor: theme.colors.surfaceAlt,
                    borderColor: theme.colors.inputBorder,
                    fontFamily: fontFamilyFor(theme.typography.body.fontWeight),
                  },
                ]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('chat.send')}
                accessibilityState={{ disabled: text.trim().length === 0 }}
                disabled={text.trim().length === 0}
                onPress={() => void submit()}
                testID="send"
                style={[
                  styles.round,
                  {
                    backgroundColor: theme.colors.primary,
                    borderColor: theme.colors.primary,
                    opacity: text.trim().length === 0 ? 0.4 : 1,
                  },
                ]}
              >
                <Icon icon={Send} size={20} color={theme.colors.onPrimary} />
              </Pressable>
            </View>
          </View>
        ) : null}

        <Modal
          visible={selected !== null}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setSelected(null);
          }}
        >
          <Pressable
            style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            onPress={() => {
              setSelected(null);
            }}
          >
            <View
              style={[
                styles.sheet,
                { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg },
              ]}
              testID="message-actions"
            >
              <View
                style={styles.row}
                accessibilityRole="radiogroup"
                accessibilityLabel={t('chat.react')}
              >
                {REACTIONS.map((emoji) => {
                  const on = selected?.reactions.some((r) => r.emoji === emoji && r.mine) ?? false;
                  return (
                    <Button
                      key={emoji}
                      label={emoji}
                      variant={on ? 'primary' : 'ghost'}
                      selected={on}
                      onPress={() => {
                        if (selected)
                          react.mutate(
                            { messageId: selected.id, emoji, add: !on },
                            { onError: fail },
                          );
                        setSelected(null);
                      }}
                      testID={`react-${emoji}`}
                    />
                  );
                })}
              </View>
              {canWrite ? (
                <Button
                  label={t('chat.reply')}
                  variant="secondary"
                  onPress={() => {
                    setReplyTo(selected);
                    setSelected(null);
                  }}
                  testID="reply"
                />
              ) : null}
              <Button
                label={t('chat.deleteForMe')}
                variant="secondary"
                onPress={() => {
                  if (selected)
                    del.mutate({ messageId: selected.id, scope: 'me' }, { onError: fail });
                  setSelected(null);
                }}
                testID="delete-me"
              />
              {selected?.mine &&
              Date.now() - new Date(selected.createdAt).getTime() <
                LIMITS.chat.deleteForEveryoneWindowMs ? (
                <Button
                  label={t('chat.deleteForEveryone')}
                  variant="danger"
                  onPress={() => {
                    del.mutate({ messageId: selected.id, scope: 'everyone' }, { onError: fail });
                    setSelected(null);
                  }}
                  testID="delete-everyone"
                />
              ) : null}
              {selected && !selected.mine ? (
                <Button
                  label={t('chat.report')}
                  variant="ghost"
                  onPress={() => {
                    router.push({
                      pathname: '/report',
                      params: {
                        targetType: 'message',
                        targetId: selected.id,
                        name: selected.sender?.displayName ?? '',
                      },
                    });
                    setSelected(null);
                  }}
                  testID="report-message"
                />
              ) : null}
            </View>
          </Pressable>
        </Modal>

        <Modal
          visible={muteOpen}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setMuteOpen(false);
          }}
        >
          <Pressable
            style={[styles.backdrop, { backgroundColor: theme.colors.overlay }]}
            accessibilityRole="button"
            accessibilityLabel={t('common.cancel')}
            onPress={() => {
              setMuteOpen(false);
            }}
          >
            <View
              style={[
                styles.sheet,
                { backgroundColor: theme.colors.surface, borderRadius: theme.radii.lg },
              ]}
            >
              {(['hour', 'day', 'week', 'forever'] as const).map((d) => (
                <Button
                  key={d}
                  label={t(`chat.mute_${d}`)}
                  variant="secondary"
                  onPress={() => {
                    mute.mutateAsync(d).catch(fail);
                    setMuteOpen(false);
                  }}
                  testID={`mute-${d}`}
                />
              ))}
            </View>
          </Pressable>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  banner: { padding: 16, gap: 8 },
  list: { paddingHorizontal: 16, paddingVertical: 8 },
  typing: { paddingHorizontal: 16 },
  composer: { borderTopWidth: 1, paddingHorizontal: 10, paddingVertical: 8, gap: 4 },
  composerRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  round: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 132,
    borderWidth: 1.5,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
  },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  grow: { flexGrow: 1, flexShrink: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', padding: 16 },
  sheet: { padding: 16, gap: 8 },
});
