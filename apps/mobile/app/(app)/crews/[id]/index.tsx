import type { CrewDetail, CrewMember } from '@touchgrass/shared';
import { parseRRule } from '@touchgrass/shared';
import type { TFunction } from 'i18next';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { PersonRow } from '../../../../components/PersonRow';
import { Button, ErrorState, ListRow, LoadingState, Screen, Text } from '../../../../components/ui';
import {
  useCrew,
  useCrewChat,
  useCrewHistory,
  useCrewMemberAction,
  useCrewMembership,
} from '../../../../src/features/engagement/api';
import { formatWhen } from '../../../../src/features/events/format';
import { errorMessage } from '../../../../src/lib/errors';
import { shareLinks, shareText } from '../../../../src/features/share/share';

const CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'] as const;

/** Human description of a crew's rule ("Every week on Sun"); anything unusual reads "Custom schedule". */
export function describeRule(t: TFunction, rule: string): string {
  try {
    const r = parseRRule(rule);
    const days = r.byDay.map((d) => t(`crews.days.${CODES[d.weekday - 1] ?? 'MO'}`));
    if (r.freq === 'WEEKLY' && r.interval <= 2) {
      const list = days.length > 0 ? days.join(', ') : '';
      return t(r.interval === 1 ? 'crews.describeWeekly' : 'crews.describeBiweekly', {
        days: list,
      });
    }
    const first = r.byDay[0];
    if (
      r.freq === 'MONTHLY' &&
      r.interval === 1 &&
      first !== undefined &&
      first.ordinal !== null &&
      r.byDay.length === 1
    )
      return t('crews.describeMonthly', {
        nth: t(`crews.ordinals.${String(first.ordinal)}`, { defaultValue: String(first.ordinal) }),
        day: days[0] ?? '',
      });
    return t('crews.describeOther');
  } catch {
    return t('crews.describeOther');
  }
}

/** A crew (F-ENG-02): who's in, the schedule, upcoming sessions, chat, history; admins manage requests. */
export default function CrewScreen() {
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
  return <CrewView crew={q.data} />;
}

function CrewView({ crew }: { crew: CrewDetail }) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const membership = useCrewMembership(crew.id);
  const member = useCrewMemberAction(crew.id);
  const chat = useCrewChat(crew.id);
  const active = crew.viewer.status === 'active';
  const history = useCrewHistory(crew.id, active);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  const openPerson = (m: CrewMember) => () => {
    router.push({ pathname: '/users/[id]', params: { id: m.person.id } });
  };

  return (
    <Screen testID="crew-screen">
      <Text variant="title" accessibilityRole="header">
        {crew.name}
      </Text>
      {crew.description ? <Text>{crew.description}</Text> : null}
      {crew.held ? (
        <Text tone="muted" accessibilityRole="alert" testID="crew-held">
          {t('moderation.held')}
        </Text>
      ) : null}
      <Text tone="muted">
        {[
          t('crews.members', { count: crew.memberCount }),
          crew.joinPolicy === 'invite_only' ? t('crews.policyInvite') : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </Text>

      {crew.viewer.status === null ? (
        <Button
          label={t('crews.join')}
          loading={membership.isPending}
          onPress={() => void run(() => membership.mutateAsync({ action: 'join' }))}
          testID="crew-join"
        />
      ) : crew.viewer.status === 'requested' ? (
        <Text tone="muted" testID="crew-requested">
          {t('crews.requested')}
        </Text>
      ) : crew.viewer.status === 'invited' ? (
        <View style={styles.row}>
          <Text>{t('crews.invited')}</Text>
          <Button
            label={t('crews.accept')}
            onPress={() => void run(() => membership.mutateAsync({ action: 'accept' }))}
            testID="crew-accept"
          />
          <Button
            label={t('crews.decline')}
            variant="ghost"
            onPress={() =>
              void run(async () => {
                await membership.mutateAsync({ action: 'decline' });
                router.back();
              })
            }
            testID="crew-decline"
          />
        </View>
      ) : (
        <Button
          label={t('crews.chat')}
          variant="secondary"
          loading={chat.isPending}
          onPress={() =>
            void run(async () => {
              const c = await chat.mutateAsync();
              router.push({ pathname: '/chats/[id]', params: { id: c.id } });
            })
          }
          testID="crew-chat"
        />
      )}
      {crew.joinPolicy === 'request' && !crew.held ? (
        <Button
          label={t('share.shareCrew')}
          variant="secondary"
          onPress={() =>
            void shareText(
              t('share.crewMessage', { name: crew.name, url: shareLinks.crew(crew.id) }),
            )
          }
          testID="share-crew"
        />
      ) : null}
      {error ? (
        <Text tone="danger" accessibilityRole="alert" testID="crew-error">
          {error}
        </Text>
      ) : null}

      <Text variant="heading" accessibilityRole="header">
        {t('crews.schedule')}
      </Text>
      {crew.recurrence ? (
        <Text testID="crew-schedule">
          {describeRule(t, crew.recurrence.rrule)} · {crew.recurrence.placeLabel}
          {crew.recurrence.active ? '' : ` · ${t('crews.paused')}`}
        </Text>
      ) : (
        <Text tone="muted">{t('crews.noSchedule')}</Text>
      )}
      {crew.canManage ? (
        <View style={styles.row}>
          <Button
            label={crew.recurrence ? t('crews.editSchedule') : t('crews.setSchedule')}
            variant="secondary"
            onPress={() => {
              router.push({ pathname: '/crews/[id]/schedule', params: { id: crew.id } });
            }}
            testID="crew-set-schedule"
          />
          <Button
            label={t('crews.invite')}
            variant="secondary"
            onPress={() => {
              router.push({ pathname: '/crews/[id]/invite', params: { id: crew.id } });
            }}
            testID="crew-invite"
          />
        </View>
      ) : null}

      {active ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('crews.upcoming')}
          </Text>
          {crew.upcoming.length === 0 ? <Text tone="muted">{t('crews.noSessions')}</Text> : null}
          {crew.upcoming.map((s) => (
            <ListRow
              key={s.eventId}
              label={formatWhen(s.startsAt, i18n.language)}
              detail={
                s.status === 'cancelled'
                  ? t('crews.cancelled')
                  : t('crews.going', { count: s.goingCount })
              }
              onPress={() => {
                router.push({ pathname: '/events/[id]', params: { id: s.eventId } });
              }}
              testID={`session-${s.eventId}`}
            />
          ))}
        </>
      ) : null}

      {crew.canManage && crew.requests.length > 0 ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('crews.requests')}
          </Text>
          {crew.requests.map((r) => (
            <PersonRow
              key={r.person.id}
              person={r.person}
              onOpen={openPerson(r)}
              actions={
                <View style={styles.row}>
                  <Button
                    label={t('crews.approve')}
                    onPress={() =>
                      void run(() => member.mutateAsync({ userId: r.person.id, action: 'approve' }))
                    }
                    testID={`approve-${r.person.id}`}
                  />
                  <Button
                    label={t('crews.decline')}
                    variant="ghost"
                    onPress={() =>
                      void run(() => member.mutateAsync({ userId: r.person.id, action: 'decline' }))
                    }
                    testID={`decline-${r.person.id}`}
                  />
                </View>
              }
            />
          ))}
        </>
      ) : null}

      <Text variant="heading" accessibilityRole="header">
        {t('crews.members', { count: crew.memberCount })}
      </Text>
      {crew.members.map((m) => (
        <PersonRow
          key={m.person.id}
          person={m.person}
          detail={[
            m.role === 'admin' ? t('crews.admin') : null,
            t('crews.sessionsMade', { count: m.attended }),
          ]
            .filter(Boolean)
            .join(' · ')}
          onOpen={openPerson(m)}
          actions={
            crew.canManage && crew.viewer.status === 'active' ? (
              <View style={styles.row}>
                <Button
                  label={m.role === 'admin' ? t('crews.makeMember') : t('crews.makeAdmin')}
                  variant="ghost"
                  onPress={() =>
                    void run(() =>
                      member.mutateAsync({
                        userId: m.person.id,
                        action: m.role === 'admin' ? 'make_member' : 'make_admin',
                      }),
                    )
                  }
                  testID={`role-${m.person.id}`}
                />
              </View>
            ) : null
          }
        />
      ))}

      {active && history.data && history.data.items.length > 0 ? (
        <>
          <Text variant="heading" accessibilityRole="header">
            {t('crews.history')}
          </Text>
          <Text tone="muted" testID="crew-attended">
            {t('crews.attended', { count: history.data.attendedCount })}
          </Text>
          {history.data.items.map((s) => (
            <ListRow
              key={s.eventId}
              label={formatWhen(s.startsAt, i18n.language)}
              detail={[
                s.attended ? t('crews.youWent') : null,
                t('crews.checkedIn', { count: s.checkedInCount }),
              ]
                .filter(Boolean)
                .join(' · ')}
              onPress={() => {
                router.push({ pathname: '/events/[id]', params: { id: s.eventId } });
              }}
            />
          ))}
        </>
      ) : null}

      {active ? (
        <Button
          label={t('crews.leave')}
          variant="danger"
          onPress={() =>
            void run(async () => {
              await membership.mutateAsync({ action: 'leave' });
              router.back();
            })
          }
          testID="crew-leave"
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
});
