import type { EventComment } from '@touchgrass/shared';
import { LIMITS } from '@touchgrass/shared';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { formatWhen } from '../src/features/events/format';
import {
  useDeleteComment,
  useEventComments,
  usePostComment,
} from '../src/features/events/comments';
import { errorMessage } from '../src/lib/errors';
import { useTheme } from '../src/theme/theme';
import { Avatar } from './Avatar';
import { Flag, Send, Trash } from './icons';
import { Button, ErrorState, FadeIn, Icon, IconButton, Pill, Text, TextField } from './ui';

/**
 * Comments under a plan (D-156): anyone who can see the plan can ask the host something or say hi, in the
 * open. Newest first; your held comments show only to you; hosts can remove any comment on their plan.
 */
export function EventComments({ eventId }: { eventId: string }) {
  const { t } = useTranslation();
  const q = useEventComments(eventId);
  const post = usePostComment(eventId);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const pages = q.data?.pages ?? [];
  const items = pages.flatMap((p) => p.items);
  const canComment = pages[0]?.canComment ?? false;

  const send = async (): Promise<void> => {
    const body = draft.trim();
    if (!body) return;
    setError(null);
    try {
      await post.mutateAsync(body);
      setDraft('');
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <View style={styles.wrap} testID="event-comments">
      <Text variant="heading" accessibilityRole="header">
        {t('comments.title')}
      </Text>
      {q.isError ? (
        <ErrorState
          message={errorMessage(t, q.error) ?? undefined}
          onRetry={() => void q.refetch()}
        />
      ) : null}
      {canComment ? (
        <View style={styles.composer}>
          <View style={styles.grow}>
            <TextField
              label={t('comments.placeholder')}
              value={draft}
              onChangeText={setDraft}
              maxLength={LIMITS.comments.maxLength}
              multiline
              testID="comment-input"
            />
          </View>
          <IconButton
            icon={<Icon icon={Send} size={18} />}
            label={t('comments.send')}
            onPress={() => void send()}
            testID="comment-send"
          />
        </View>
      ) : q.data ? (
        <Text tone="muted">{t('comments.closed')}</Text>
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityRole="alert" testID="comment-error">
          {error}
        </Text>
      ) : null}
      {q.data && items.length === 0 ? (
        <Text tone="muted" testID="comments-empty">
          {t('comments.empty')}
        </Text>
      ) : null}
      {items.map((c, i) => (
        <FadeIn key={c.id} delay={i < 5 ? i * 40 : 0} distance={6}>
          <CommentRow eventId={eventId} comment={c} />
        </FadeIn>
      ))}
      {q.hasNextPage ? (
        <Button
          label={t('comments.more')}
          variant="ghost"
          loading={q.isFetchingNextPage}
          onPress={() => void q.fetchNextPage()}
          testID="comments-more"
        />
      ) : null}
    </View>
  );
}

function CommentRow({ eventId, comment }: { eventId: string; comment: EventComment }) {
  const { t, i18n } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const remove = useDeleteComment(eventId);
  return (
    <View
      style={[styles.row, { borderColor: theme.colors.border }]}
      testID={`comment-${comment.id}`}
    >
      <Avatar photo={comment.author.photo} name={comment.author.displayName} size={32} />
      <View style={styles.grow}>
        <View style={styles.meta}>
          <Text variant="label" numberOfLines={1}>
            {comment.author.displayName}
          </Text>
          {comment.fromHost ? <Pill label={t('comments.host')} tone="primary" /> : null}
          <Text variant="caption" tone="muted">
            {formatWhen(comment.createdAt, i18n.language)}
          </Text>
        </View>
        <Text>{comment.body}</Text>
        {comment.held ? (
          <Text variant="caption" tone="muted">
            {t('comments.held')}
          </Text>
        ) : null}
      </View>
      {comment.canDelete ? (
        <IconButton
          icon={<Icon icon={Trash} size={16} color={theme.colors.danger} />}
          label={t('comments.delete')}
          onPress={() => {
            remove.mutate(comment.id);
          }}
          testID={`comment-delete-${comment.id}`}
        />
      ) : null}
      {!comment.mine ? (
        <IconButton
          icon={<Icon icon={Flag} size={16} />}
          label={t('comments.report')}
          onPress={() => {
            router.push({
              pathname: '/report',
              params: {
                targetType: 'event_comment',
                targetId: comment.id,
                name: comment.author.displayName,
              },
            });
          }}
          testID={`comment-report-${comment.id}`}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  grow: { flex: 1, gap: 4 },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
});
