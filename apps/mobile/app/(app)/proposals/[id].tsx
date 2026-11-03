import type { ProposalDetail, ProposalOption, ProposalOptionKind } from '@touchgrass/shared';
import { LIMITS } from '@touchgrass/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { type PickedPlace, VenuePicker } from '../../../components/engagement/VenuePicker';
import {
  Button,
  Chip,
  ErrorState,
  LoadingState,
  Screen,
  Text,
  TextField,
} from '../../../components/ui';
import {
  useAddOption,
  useCancelProposal,
  useLockProposal,
  useProposal,
  useVote,
} from '../../../src/features/engagement/api';
import { formatWhen, istToIso } from '../../../src/features/events/format';
import { errorMessage } from '../../../src/lib/errors';

/** A plan up for a vote (F-ENG-03): suggest times, places and activities, vote, and the organiser locks it. */
export default function ProposalScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const q = useProposal(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  return <ProposalView p={q.data} />;
}

function ProposalView({ p }: { p: ProposalDetail }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const vote = useVote(p.id);
  const add = useAddOption(p.id);
  const lock = useLockProposal(p.id);
  const cancel = useCancelProposal(p.id);
  const [error, setError] = useState<string | null>(null);
  const [picks, setPicks] = useState<Partial<Record<ProposalOptionKind, string>>>({});
  const [adding, setAdding] = useState<ProposalOptionKind | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('19:00');
  const [label, setLabel] = useState('');
  const [place, setPlace] = useState<PickedPlace | null>(null);
  const open = p.status === 'open' && Date.now() < Date.parse(p.deadline);
  const run = async (fn: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await fn();
      return true;
    } catch (err) {
      setError(errorMessage(t, err));
      return false;
    }
  };
  const optionLabel = (o: ProposalOption): string =>
    o.kind === 'time' && o.startsAt ? formatWhen(o.startsAt, i18n.language) : o.label;

  const submitOption = async (): Promise<void> => {
    if (adding === 'time') {
      const startsAt = istToIso(date, time);
      if (!startsAt) {
        setError(t('errors.VALIDATION_FAILED'));
        return;
      }
      if (await run(() => add.mutateAsync({ kind: 'time', startsAt, durationMinutes: 120 })))
        setAdding(null);
    } else if (adding === 'place' && place) {
      if (await run(() => add.mutateAsync({ kind: 'place', where: place.where }))) setAdding(null);
    } else if (adding === 'activity' && label.trim().length >= 2) {
      if (
        await run(() =>
          add.mutateAsync({ kind: 'activity', label: label.trim(), interestId: null }),
        )
      ) {
        setLabel('');
        setAdding(null);
      }
    }
  };

  const section = (kind: ProposalOptionKind, title: string, addLabel: string) => {
    const options = p.options.filter((o) => o.kind === kind);
    return (
      <View style={styles.section} key={kind}>
        <Text variant="heading" accessibilityRole="header">
          {title}
        </Text>
        {options.length === 0 ? <Text tone="muted">{t('proposals.noOptions')}</Text> : null}
        {options.map((o) => (
          <View key={o.id} style={styles.option} testID={`option-${o.id}`}>
            <View style={styles.grow}>
              <Text variant="label">{optionLabel(o)}</Text>
              <Text variant="caption" tone="muted">
                {[
                  t('proposals.votes', { count: o.votes }),
                  o.voters.map((v) => v.displayName).join(', '),
                  o.createdBy ? t('proposals.by', { name: o.createdBy.displayName }) : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            {open ? (
              <Chip
                label={t('proposals.voteFor', { option: optionLabel(o) })}
                selected={o.mine}
                onToggle={() => void run(() => vote.mutateAsync({ optionId: o.id, vote: !o.mine }))}
                testID={`vote-${o.id}`}
              />
            ) : null}
            {p.canLock ? (
              <Chip
                label={t('proposals.selected')}
                kind="radio"
                selected={picks[kind] === o.id}
                onToggle={() => {
                  setPicks((s) => ({ ...s, [kind]: s[kind] === o.id ? undefined : o.id }));
                }}
                testID={`pick-${o.id}`}
              />
            ) : null}
          </View>
        ))}
        {open ? (
          <Button
            label={addLabel}
            variant="ghost"
            onPress={() => {
              setAdding(adding === kind ? null : kind);
            }}
            testID={`add-${kind}`}
          />
        ) : null}
        {adding === kind ? (
          <View style={styles.section}>
            {kind === 'time' ? (
              <>
                <TextField
                  label={t('crews.date')}
                  value={date}
                  onChangeText={setDate}
                  placeholder="21/11/2026"
                  testID="option-date"
                />
                <TextField
                  label={t('crews.time')}
                  value={time}
                  onChangeText={setTime}
                  testID="option-time"
                />
              </>
            ) : kind === 'place' ? (
              <VenuePicker picked={place} onPick={setPlace} testID="option-place" />
            ) : (
              <TextField
                label={t('proposals.activityLabel')}
                value={label}
                onChangeText={setLabel}
                maxLength={LIMITS.proposals.optionLabelMaxLength}
                testID="option-activity"
              />
            )}
            <Button
              label={t('proposals.add')}
              loading={add.isPending}
              onPress={() => void submitOption()}
              testID="option-save"
            />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Screen testID="proposal-screen">
      <Text variant="title" accessibilityRole="header">
        {p.title}
      </Text>
      {p.held ? (
        <Text tone="muted" accessibilityRole="alert" testID="proposal-held">
          {t('moderation.held')}
        </Text>
      ) : null}
      <Text tone="muted">
        {p.status === 'open'
          ? t('proposals.closes', { time: formatWhen(p.deadline, i18n.language) })
          : p.status === 'locked'
            ? t('proposals.locked')
            : p.cancelledReason === 'NO_OPTIONS'
              ? t('proposals.cancelledNoOptions')
              : p.cancelledReason === 'BY_CREATOR'
                ? t('proposals.cancelledByCreator')
                : t('proposals.cancelled')}
      </Text>
      <Text>
        {t('proposals.invitees')} {[p.creator, ...p.invitees].map((x) => x.displayName).join(', ')}
      </Text>
      {p.eventId ? (
        <Button
          label={t('proposals.openPlan')}
          onPress={() => {
            router.push({ pathname: '/events/[id]', params: { id: p.eventId ?? '' } });
          }}
          testID="proposal-open-plan"
        />
      ) : null}
      {section('time', t('proposals.times'), t('proposals.addTime'))}
      {section('place', t('proposals.places'), t('proposals.addPlace'))}
      {section('activity', t('proposals.activities'), t('proposals.addActivity'))}
      {error ? (
        <Text tone="danger" accessibilityRole="alert" testID="proposal-error">
          {error}
        </Text>
      ) : null}
      {p.canLock ? (
        <>
          <Text variant="caption" tone="muted">
            {t('proposals.lockHint')}
          </Text>
          <Button
            label={t('proposals.lock')}
            disabled={!picks.time || !picks.place}
            loading={lock.isPending}
            onPress={() =>
              void run(() =>
                lock.mutateAsync({
                  timeOptionId: picks.time ?? '',
                  placeOptionId: picks.place ?? '',
                  activityOptionId: picks.activity ?? null,
                }),
              )
            }
            testID="proposal-lock"
          />
        </>
      ) : null}
      {p.viewerIsCreator && p.status === 'open' ? (
        <Button
          label={t('proposals.callOff')}
          variant="ghost"
          onPress={() => void run(() => cancel.mutateAsync())}
          testID="proposal-cancel"
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  option: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  grow: { flexGrow: 1, flexShrink: 1, minWidth: 160 },
});
