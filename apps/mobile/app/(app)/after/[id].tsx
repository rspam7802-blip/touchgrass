import {
  GREAT_TAGS,
  type GreatTag,
  IMPROVE_TAGS,
  type ImproveTag,
  LIMITS,
  type PostEventCard,
  type ReconnectCandidate,
} from '@touchgrass/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { ChipGroup } from '../../../components/ChipGroup';
import { PersonRow } from '../../../components/PersonRow';
import { StarRating } from '../../../components/StarRating';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../../components/ui';
import {
  useDismissPostEvent,
  usePostEventCard,
  usePull,
  useSubmitFeedback,
} from '../../../src/features/after/api';
import { formatWhen } from '../../../src/features/events/format';
import { errorMessage, reasonText } from '../../../src/lib/errors';

/**
 * "How was it?" (F-AFT-01..03): rate the plan and the host, private feedback, pull the people you met,
 * add to the Lore, and see badges earned. Opens once after a checked-in plan ends; reachable from the plan too.
 */
export default function AfterEventScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const q = usePostEventCard(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  return <AfterEventView card={q.data} />;
}

function AfterEventView({ card }: { card: PostEventCard }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const eventId = card.event.id;
  const submit = useSubmitFeedback(eventId);
  const dismiss = useDismissPostEvent(eventId);
  const pull = usePull(eventId);
  const mine = card.feedback;
  const [rating, setRating] = useState<number | null>(mine?.rating ?? null);
  const [hostRating, setHostRating] = useState<number | null>(mine?.hostRating ?? null);
  const [great, setGreat] = useState<GreatTag[]>(mine?.great ?? []);
  const [improve, setImprove] = useState<ImproveTag[]>(mine?.improve ?? []);
  const [comment, setComment] = useState(mine?.comment ?? '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const feedbackOpen = Date.now() < Date.parse(card.feedbackOpenUntil);

  const send = async (): Promise<void> => {
    if (rating === null) return;
    setError(null);
    try {
      await submit.mutateAsync({ rating, hostRating, great, improve, comment });
      setSent(true);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const close = async (wrapUp: boolean): Promise<void> => {
    setError(null);
    try {
      if (wrapUp) await dismiss.mutateAsync();
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <Screen testID="after-screen">
      <Text variant="title" accessibilityRole="header">
        {t('after.title')}
      </Text>
      <View>
        <Text variant="heading">{card.event.title}</Text>
        <Text tone="muted">{formatWhen(card.event.startsAt, i18n.language)}</Text>
      </View>

      {!feedbackOpen ? (
        <Text tone="muted" testID="feedback-closed">
          {reasonText(t, 'FEEDBACK_CLOSED')}
        </Text>
      ) : sent ? (
        <Text tone="primary" testID="feedback-thanks" accessibilityLiveRegion="polite">
          {t('after.thanks')}
        </Text>
      ) : (
        <View style={styles.section}>
          <StarRating
            label={t('after.rateEvent')}
            value={rating}
            onChange={setRating}
            testID="rate-event"
          />
          {card.host ? (
            <StarRating
              label={t('after.rateHost', { name: card.host.displayName })}
              value={hostRating}
              onChange={setHostRating}
              testID="rate-host"
            />
          ) : null}
          <ChipGroup
            label={t('after.whatWasGreat')}
            mode="multi"
            options={GREAT_TAGS.map((g) => ({ id: g, label: t(`after.great.${g}`) }))}
            selected={great}
            onChange={(next) => {
              setGreat(GREAT_TAGS.filter((g) => next.includes(g)));
            }}
            testIDPrefix="great"
          />
          <ChipGroup
            label={t('after.whatCouldImprove')}
            mode="multi"
            options={IMPROVE_TAGS.map((g) => ({ id: g, label: t(`after.improve.${g}`) }))}
            selected={improve}
            onChange={(next) => {
              setImprove(IMPROVE_TAGS.filter((g) => next.includes(g)));
            }}
            testIDPrefix="improve"
          />
          <TextField
            label={t('after.comment')}
            hint={t('after.commentHint')}
            value={comment}
            onChangeText={setComment}
            maxLength={LIMITS.after.commentMaxLength}
            multiline
            testID="feedback-comment"
          />
          <Button
            label={t('after.send')}
            disabled={rating === null}
            loading={submit.isPending}
            onPress={() => void send()}
            testID="send-feedback"
          />
        </View>
      )}

      <View style={styles.section}>
        <Text variant="heading" accessibilityRole="header">
          {t('after.peopleYouMet')}
        </Text>
        {card.people.length === 0 ? (
          <EmptyState title={t('after.noPeople')} />
        ) : (
          <>
            <Text variant="caption" tone="muted">
              {t('after.pullHint')}
            </Text>
            {card.people.map((c) => (
              <PersonRow
                key={c.person.id}
                person={c.person}
                onOpen={() => {
                  router.push({ pathname: '/users/[id]', params: { id: c.person.id } });
                }}
                actions={
                  <PullButton
                    candidate={c}
                    busy={pull.isPending && pull.variables === c.person.id}
                    onPull={() => {
                      setError(null);
                      pull.mutateAsync(c.person.id).catch((err: unknown) => {
                        setError(errorMessage(t, err));
                      });
                    }}
                  />
                }
              />
            ))}
          </>
        )}
      </View>

      <View style={styles.section}>
        <Text variant="heading" accessibilityRole="header">
          {t('lore.title')}
        </Text>
        <Button
          label={
            card.loreCount > 0 ? t('after.seeLore', { count: card.loreCount }) : t('after.addLore')
          }
          variant="secondary"
          disabled={card.loreCount === 0 && !card.canAddLore}
          onPress={() => {
            router.push({ pathname: '/events/[id]/lore', params: { id: eventId } });
          }}
          testID="after-lore"
        />
      </View>

      {card.badges.length > 0 ? (
        <View style={styles.section} testID="after-badges">
          <Text variant="heading" accessibilityRole="header">
            {t('after.badgesEarned')}
          </Text>
          <View style={styles.badges}>
            {card.badges.map((b) => (
              <Text key={b.key} accessibilityLabel={b.name}>
                {b.emoji} {b.name}
              </Text>
            ))}
          </View>
        </View>
      ) : null}

      {error ? (
        <Text tone="danger" accessibilityRole="alert" testID="after-error">
          {error}
        </Text>
      ) : null}
      <View style={styles.row}>
        <Button
          label={t('after.done')}
          style={styles.grow}
          loading={dismiss.isPending}
          onPress={() => void close(true)}
          testID="after-done"
        />
        <Button
          label={t('after.later')}
          variant="ghost"
          style={styles.grow}
          onPress={() => void close(false)}
          testID="after-later"
        />
      </View>
    </Screen>
  );
}

function PullButton({
  candidate,
  busy,
  onPull,
}: {
  candidate: ReconnectCandidate;
  busy: boolean;
  onPull: () => void;
}) {
  const { t } = useTranslation();
  const id = candidate.person.id;
  switch (candidate.state) {
    case 'squad':
      return (
        <Text tone="primary" testID={`pull-state-${id}`}>
          {t('after.squad')}
        </Text>
      );
    case 'request_sent':
      return (
        <Text tone="muted" testID={`pull-state-${id}`}>
          {t('after.requestSent')}
        </Text>
      );
    case 'pulled':
      return (
        <Text tone="muted" testID={`pull-state-${id}`}>
          {t('after.pulled')}
        </Text>
      );
    case 'pulled_you':
      return (
        <Button
          label={t('after.pulledYou')}
          loading={busy}
          onPress={onPull}
          accessibilityHint={t('after.pullHint')}
          testID={`pull-${id}`}
        />
      );
    case 'none':
      return (
        <Button
          label={t('after.pull')}
          variant="secondary"
          loading={busy}
          onPress={onPull}
          accessibilityHint={t('after.pullHint')}
          testID={`pull-${id}`}
        />
      );
  }
}

const styles = StyleSheet.create({
  section: { gap: 12 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flexGrow: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
});
