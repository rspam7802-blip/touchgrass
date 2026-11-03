import {
  buildRRule,
  CrewRecurrenceBody,
  LIMITS,
  parseRRule,
  type RRuleFreq,
  WEEKDAY_CODES,
  type WeekdayCode,
} from '@touchgrass/shared';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChipGroup } from '../../../../components/ChipGroup';
import { type PickedPlace, VenuePicker } from '../../../../components/engagement/VenuePicker';
import {
  Button,
  ErrorState,
  LoadingState,
  Screen,
  SwitchRow,
  Text,
  TextField,
} from '../../../../components/ui';
import { useCrew, useCrewSchedule } from '../../../../src/features/engagement/api';
import { isoToIst, istToIso } from '../../../../src/features/events/format';
import { errorMessage } from '../../../../src/lib/errors';

type Repeat = 'weekly' | 'biweekly' | 'monthly';
const ORDINALS = ['1', '2', '3', '4', '-1'] as const;

/** Crew schedule (F-ENG-02): a simple repeat picker that writes an RRULE; sessions are created ahead of time. */
export default function CrewScheduleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { t } = useTranslation();
  const q = useCrew(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  const r = q.data.recurrence;
  let initial: { repeat: Repeat; days: WeekdayCode[]; ordinal: string } = {
    repeat: 'weekly',
    days: ['SU'],
    ordinal: '1',
  };
  if (r) {
    try {
      const p = parseRRule(r.rrule);
      initial = {
        repeat: p.freq === 'MONTHLY' ? 'monthly' : p.interval === 2 ? 'biweekly' : 'weekly',
        days: p.byDay.map((d) => WEEKDAY_CODES[d.weekday - 1] ?? 'SU'),
        ordinal: String(p.byDay[0]?.ordinal ?? 1),
      };
    } catch {
      // An unusual rule is replaced by whatever the admin picks now.
    }
  }
  const when = r ? isoToIst(r.startsAt) : { date: '', time: '07:00' };
  return (
    <ScheduleForm
      crewId={id}
      initial={{
        ...initial,
        date: when.date,
        time: when.time,
        minutes: String(r?.durationMinutes ?? 90),
        capacity: String(r?.capacity ?? 20),
        title: r?.title ?? '',
        active: r?.active ?? true,
      }}
    />
  );
}

function ScheduleForm({
  crewId,
  initial,
}: {
  crewId: string;
  initial: {
    repeat: Repeat;
    days: WeekdayCode[];
    ordinal: string;
    date: string;
    time: string;
    minutes: string;
    capacity: string;
    title: string;
    active: boolean;
  };
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const save = useCrewSchedule(crewId);
  const [repeat, setRepeat] = useState<Repeat>(initial.repeat);
  const [days, setDays] = useState<WeekdayCode[]>(initial.days);
  const [ordinal, setOrdinal] = useState(initial.ordinal);
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [minutes, setMinutes] = useState(initial.minutes);
  const [capacity, setCapacity] = useState(initial.capacity);
  const [title, setTitle] = useState(initial.title);
  const [active, setActive] = useState(initial.active);
  const [place, setPlace] = useState<PickedPlace | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setError(null);
    const startsAt = istToIso(date, time);
    if (!startsAt || !place || days.length === 0) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    let rrule: string;
    try {
      const freq: RRuleFreq = repeat === 'monthly' ? 'MONTHLY' : 'WEEKLY';
      rrule = buildRRule({
        freq,
        interval: repeat === 'biweekly' ? 2 : 1,
        weekdays: repeat === 'monthly' ? days.slice(0, 1) : days,
        ordinal: repeat === 'monthly' ? Number(ordinal) : null,
      });
    } catch {
      setError(t('events.reasons.BAD_RECURRENCE'));
      return;
    }
    const parsed = CrewRecurrenceBody.safeParse({
      rrule,
      startsAt,
      durationMinutes: Number(minutes),
      capacity: Number(capacity),
      where: place.where,
      title: title.trim(),
      active,
    });
    if (!parsed.success) {
      setError(t('errors.VALIDATION_FAILED'));
      return;
    }
    try {
      await save.mutateAsync(parsed.data);
      router.back();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  return (
    <Screen testID="crew-schedule-screen">
      <ChipGroup
        label={t('crews.repeats')}
        mode="single"
        options={[
          { id: 'weekly', label: t('crews.weekly') },
          { id: 'biweekly', label: t('crews.biweekly') },
          { id: 'monthly', label: t('crews.monthly') },
        ]}
        selected={[repeat]}
        onChange={(next) => {
          const v = next[0];
          if (v === 'weekly' || v === 'biweekly' || v === 'monthly') {
            setRepeat(v);
            if (v === 'monthly') setDays((d) => d.slice(0, 1));
          }
        }}
        testIDPrefix="repeat"
      />
      <ChipGroup
        label={t('crews.onDays')}
        mode={repeat === 'monthly' ? 'single' : 'multi'}
        options={WEEKDAY_CODES.map((c) => ({ id: c, label: t(`crews.days.${c}`) }))}
        selected={days}
        onChange={(next) => {
          setDays(WEEKDAY_CODES.filter((c) => next.includes(c)));
        }}
        testIDPrefix="day"
      />
      {repeat === 'monthly' ? (
        <ChipGroup
          label={t('crews.whichWeek')}
          mode="single"
          options={ORDINALS.map((o) => ({ id: o, label: t(`crews.ordinals.${o}`) }))}
          selected={[ordinal]}
          onChange={(next) => {
            if (next[0]) setOrdinal(next[0]);
          }}
          testIDPrefix="ordinal"
        />
      ) : null}
      <Text variant="heading" accessibilityRole="header">
        {t('crews.firstSession')}
      </Text>
      <TextField
        label={t('crews.date')}
        value={date}
        onChangeText={setDate}
        placeholder="21/11/2026"
        testID="schedule-date"
      />
      <TextField
        label={t('crews.time')}
        value={time}
        onChangeText={setTime}
        placeholder="07:00"
        testID="schedule-time"
      />
      <TextField
        label={t('crews.duration')}
        value={minutes}
        onChangeText={setMinutes}
        keyboardType="number-pad"
        testID="schedule-minutes"
      />
      <TextField
        label={t('crews.capacity')}
        value={capacity}
        onChangeText={setCapacity}
        keyboardType="number-pad"
        testID="schedule-capacity"
      />
      <TextField
        label={t('crews.sessionTitle')}
        value={title}
        onChangeText={setTitle}
        maxLength={LIMITS.event.titleMaxLength}
        testID="schedule-title"
      />
      <Text variant="heading" accessibilityRole="header">
        {t('events.where')}
      </Text>
      <VenuePicker picked={place} onPick={setPlace} testID="schedule-place" />
      <SwitchRow
        label={t('crews.pause')}
        value={!active}
        onChange={(v) => {
          setActive(!v);
        }}
        testID="schedule-paused"
      />
      {error ? (
        <Text tone="danger" accessibilityRole="alert" testID="schedule-error">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('crews.save')}
        loading={save.isPending}
        onPress={() => void submit()}
        testID="schedule-save"
      />
    </Screen>
  );
}
