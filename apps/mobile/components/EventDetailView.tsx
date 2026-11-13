import type { ReactNode } from 'react';
import { MapPin } from './icons';
import { type EventDetail, LIMITS } from '@touchgrass/shared';
import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Share, StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker } from 'react-native-maps';
import { usePriorityPass, useReferrals } from '../src/features/engagement/api';
import { useCheckIn, useJoinRequest, useRsvp } from '../src/features/events/api';
import { useRefundQuote } from '../src/features/payments/api';
import { money, refundPolicyText } from '../src/features/payments/format';
import {
  capacityLabel,
  formatTime,
  formatWhen,
  locationLabel,
  rsvpLabel,
} from '../src/features/events/format';
import { errorMessage, reasonText } from '../src/lib/errors';
import { useTheme } from '../src/theme/theme';
import { readAppEnvironment } from '../src/config';
import { calendarFields, saveToCalendar } from '../src/features/calendar/device';
import { CalendarButton } from './CalendarButton';
import { PersonRow } from './PersonRow';
import { useTrack } from '../src/features/analytics/analytics';
import { Button, FadeIn, IconText, Pop, Text, TextField } from './ui';
import { useFlag } from '../src/features/app-config/use-flag';

/**
 * Everything about one plan (F-EVT-05..17). The location shown is exactly what the API returned for this
 * viewer — an approximate circle for unrevealed mystery plans — so the screen cannot leak the spot.
 */
/** Live location can be shared for a plan from 2 h before it starts until 3 h after it ends (F-SAF-04). */
function canShareFor(
  event: Pick<EventDetail, 'startsAt' | 'endsAt' | 'status'>,
  now: number,
): boolean {
  if (event.status === 'cancelled') return false;
  return (
    now >= new Date(event.startsAt).getTime() - LIMITS.safety.eventWindowBeforeMs &&
    now <= new Date(event.endsAt).getTime() + LIMITS.safety.eventWindowAfterMs
  );
}

export function EventDetailView({
  event,
  afterRsvp,
}: {
  event: EventDetail;
  /** Shown right under the Pull up block: the plan's chat and at-the-plan tools. */
  afterRsvp?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const rsvp = useRsvp(event.id);
  const join = useJoinRequest(event.id);
  const pendingRequests = event.pendingJoinRequests ?? 0;
  const checkIn = useCheckIn(event.id);
  const pass = usePriorityPass(event.id);
  const rewards = useReferrals(event.viewer.rsvp === 'waitlisted');
  const track = useTrack();
  const liveLocation = useFlag('live_location');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [guestLink, setGuestLink] = useState<string | null>(null);
  const v = event.viewer;
  const open = event.status === 'published';
  const holdsSeat = v.rsvp === 'going' || v.rsvp === 'checked_in';
  const isPrimaryHost = v.hostRole === 'host';
  const paid = event.pricePaise > 0;
  const quote = useRefundQuote(event.id, paid && holdsSeat && !v.isHost);
  const openPayment =
    v.payment && (v.payment.status === 'created' || v.payment.status === 'failed')
      ? v.payment
      : null;
  const status = rsvpLabel(t, event);
  const go = (
    pathname:
      | '/events/[id]/invite'
      | '/events/[id]/ticket'
      | '/events/[id]/scan'
      | '/events/[id]/attendees'
      | '/events/[id]/plus-one'
      | '/events/[id]/requests'
      | '/events/[id]/checkout',
  ): void => {
    router.push({ pathname, params: { id: event.id } });
  };

  const act = async (input: Parameters<typeof rsvp.mutateAsync>[0]): Promise<boolean> => {
    setError(null);
    setNotice(null);
    try {
      const res = await rsvp.mutateAsync(input);
      if (res && 'plusOneClaimUrl' in res && res.plusOneClaimUrl) setGuestLink(res.plusOneClaimUrl);
      if (res && 'status' in res && res.status === 'waitlisted') setNotice(t('events.waitlisted'));
      return true;
    } catch (err) {
      setError(errorMessage(t, err));
      return false;
    }
  };

  const askToJoin = async (action: 'ask' | 'withdraw'): Promise<void> => {
    setError(null);
    setNotice(null);
    try {
      await join.mutateAsync(action);
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  /** "Maybe": keeps the plan on their list and pencils it into the phone's calendar as tentative. */
  const maybe = async (): Promise<void> => {
    if (!(await act({ status: 'interested' }))) return;
    const asMaybe = { ...event, viewer: { ...event.viewer, rsvp: 'interested' as const } };
    try {
      const saved = await saveToCalendar(
        asMaybe,
        calendarFields(asMaybe, t, readAppEnvironment().webUrl),
      );
      if (saved === 'added' || saved === 'updated') {
        track('calendar_added', { target: 'device' });
        setNotice(t('calendar.addedTentative'));
      }
    } catch {
      // The maybe is saved; the calendar copy is a convenience they can add from the button.
    }
  };

  const selfCheckIn = async (): Promise<void> => {
    setError(null);
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      setError(t('events.locationPermission'));
      return;
    }
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await checkIn.mutateAsync({ point: { lat: pos.coords.latitude, lng: pos.coords.longitude } });
      setNotice(t('events.checkedIn'));
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };

  const share = (): void => {
    track('share_tapped', { target: 'event' });
    void Share.share({
      message: t('events.shareMessage', { title: event.title, url: event.shareUrl }),
    });
  };

  const confirmLeave = (): void => {
    const refund =
      paid && quote.data && quote.data.paidPaise > 0
        ? quote.data.refundPaise > 0
          ? t('payments.cancelRefundQuote', {
              amount: money(quote.data.refundPaise, i18n.language),
            })
          : t('payments.cancelNoRefund')
        : null;
    Alert.alert(
      t('events.cancelRsvp'),
      [t('events.leaveConfirm'), refund].filter(Boolean).join('\n\n'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('events.cancelRsvp'),
          style: 'destructive',
          onPress: () => void act({ status: 'cancel' }),
        },
      ],
    );
  };

  const loc = event.location;
  return (
    <View style={styles.wrap} testID="event-detail">
      {/* 1. The plan itself, as a card. */}
      <FadeIn>
        <View
          style={[
            styles.hero,
            {
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              borderRadius: theme.radii.lg,
            },
          ]}
          testID="event-hero"
        >
          {event.cover ? (
            <Image
              source={{ uri: event.cover.lg }}
              style={[styles.cover, { borderRadius: theme.radii.lg }]}
              accessibilityIgnoresInvertColors
              // Decorative: the card / screen already reads the plan's title and details.
              accessible={false}
              importantForAccessibility="no"
            />
          ) : null}
          <Text variant="caption" tone="primary">
            {formatWhen(event.startsAt, i18n.language, event.timezone)} –{' '}
            {formatTime(event.endsAt, i18n.language, event.timezone)}
          </Text>
          <Text variant="title" accessibilityRole="header">
            {event.title}
          </Text>
          {v.invitedBy ? (
            <Text tone="muted">{t('events.invitedBy', { name: v.invitedBy.displayName })}</Text>
          ) : null}
          <IconText icon={MapPin} testID="event-location">
            {locationLabel(t, loc)}
          </IconText>
          {loc.kind === 'approximate' ? (
            <Text variant="caption" tone="muted" testID="event-location-hidden">
              {loc.hiddenBy === 'approval'
                ? t('events.privateSpotHidden')
                : t('events.mysteryRevealsAt', { time: formatWhen(loc.revealsAt, i18n.language) })}
            </Text>
          ) : null}
          <Text>{capacityLabel(t, event)}</Text>
        </View>
      </FadeIn>

      {/* 2. Pull up: where the viewer stands and what they can do. */}
      <FadeIn delay={70}>
        <View style={styles.wrap} testID="event-rsvp">
          {event.status === 'cancelled' ? (
            <Text tone="danger" accessibilityRole="alert">
              {event.cancelledReason
                ? t('events.cancelledBecause', { reason: event.cancelledReason })
                : t('events.cancelled')}
            </Text>
          ) : null}
          {event.held ? (
            <Text tone="muted" accessibilityRole="alert" testID="event-held">
              {t('moderation.held')}
            </Text>
          ) : null}
          {paid ? (
            <View>
              <Text variant="heading" testID="event-price">
                {money(event.pricePaise, i18n.language)}
              </Text>
              {event.refundPolicy ? (
                <Text tone="muted" testID="event-refund-policy">
                  {refundPolicyText(t, event.refundPolicy)}
                </Text>
              ) : null}
            </View>
          ) : null}

          {v.offer ? (
            <View
              style={[
                styles.banner,
                {
                  backgroundColor: theme.colors.surface,
                  borderColor: theme.colors.primary,
                  borderRadius: theme.radii.md,
                },
              ]}
            >
              <Text variant="heading">{t('events.spotOpen')}</Text>
              <Text>
                {t('events.claimBy', { time: formatTime(v.offer.expiresAt, i18n.language) })}
              </Text>
              <Button
                label={
                  paid
                    ? t('payments.pay', { amount: money(event.pricePaise, i18n.language) })
                    : t('events.claimSpot')
                }
                loading={rsvp.isPending}
                onPress={() => {
                  if (paid) go('/events/[id]/checkout');
                  else void act({ status: 'claim' });
                }}
                testID="claim-spot"
              />
            </View>
          ) : null}

          {status ? (
            <Pop trigger={v.rsvp} style={styles.popStart}>
              <Text
                variant="label"
                tone="primary"
                testID="rsvp-status"
                accessibilityLiveRegion="polite"
              >
                {status}
                {v.rsvp === 'waitlisted' && v.waitlistPosition
                  ? ` · #${String(v.waitlistPosition)}`
                  : ''}
              </Text>
            </Pop>
          ) : null}
          {open && v.rsvp === 'waitlisted' && (rewards.data?.balance.priorityPasses ?? 0) > 0 ? (
            <Button
              label={t('referrals.usePass')}
              variant="secondary"
              loading={pass.isPending}
              onPress={() => {
                setError(null);
                pass.mutateAsync().then(
                  (r) => {
                    setNotice(t('referrals.passUsed', { position: r.position }));
                  },
                  (err: unknown) => {
                    setError(errorMessage(t, err));
                  },
                );
              }}
              testID="use-priority-pass"
            />
          ) : null}
          {open && v.canRsvp ? (
            <View style={styles.row}>
              <Button
                label={
                  event.spotsLeft <= 0
                    ? t('events.joinWaitlist')
                    : paid
                      ? t('payments.pay', { amount: money(event.pricePaise, i18n.language) })
                      : t('events.pullUp')
                }
                loading={rsvp.isPending}
                onPress={() => {
                  if (paid) go('/events/[id]/checkout');
                  else void act({ status: 'going' });
                }}
                testID="pull-up"
                style={styles.grow}
              />
              {v.rsvp !== 'interested' ? (
                <Button
                  label={t('events.interested')}
                  variant="secondary"
                  onPress={() => void maybe()}
                  testID="interested"
                />
              ) : null}
            </View>
          ) : null}
          {openPayment ? (
            <Button
              label={t('payments.payNow')}
              onPress={() => {
                router.push({ pathname: '/payments/[id]', params: { id: openPayment.id } });
              }}
              testID="continue-payment"
            />
          ) : null}
          {v.payment && !openPayment && paid ? (
            <Button
              label={t('payments.receipt')}
              variant="ghost"
              onPress={() => {
                if (v.payment)
                  router.push({ pathname: '/payments/[id]', params: { id: v.payment.id } });
              }}
              testID="open-payment"
            />
          ) : null}
          {/* Private plans (D-179): ask the host, wait for their answer, or hear that it was a no. */}
          {open && !v.isHost && v.blockedReason === 'APPROVAL_REQUIRED' ? (
            v.joinRequest === 'pending' ? (
              <>
                <Text tone="primary" accessibilityLiveRegion="polite" testID="join-pending">
                  {t('events.joinPending')}
                </Text>
                <Button
                  label={t('events.joinWithdraw')}
                  variant="ghost"
                  loading={join.isPending}
                  onPress={() => void askToJoin('withdraw')}
                  testID="join-withdraw"
                />
              </>
            ) : v.joinRequest === 'declined' ? (
              <Text tone="muted" testID="join-declined">
                {t('events.joinDeclined')}
              </Text>
            ) : (
              <>
                <Text tone="muted">{t('events.privateBody')}</Text>
                <Button
                  label={t('events.joinAsk')}
                  loading={join.isPending}
                  onPress={() => void askToJoin('ask')}
                  testID="join-ask"
                />
              </>
            )
          ) : null}
          {open && v.canRsvp && v.joinRequest === 'approved' ? (
            <Text tone="primary" testID="join-approved">
              {t('events.joinApproved')}
            </Text>
          ) : null}
          {open &&
          !v.canRsvp &&
          v.blockedReason &&
          !v.isHost &&
          v.blockedReason !== 'APPROVAL_REQUIRED' &&
          v.blockedReason !== 'ALREADY_IN' ? (
            <Text tone="muted" testID="blocked-reason">
              {reasonText(t, v.blockedReason, { until: v.cooldownUntil })}
            </Text>
          ) : null}
          {/* A +1 is chosen when pulling up; the API refuses adding one to a seat you already hold. */}
          {open && event.allowPlusOnes && v.canRsvp && !v.isHost ? (
            <Button
              label={t('events.plusOneLabel')}
              variant="secondary"
              onPress={() => {
                go('/events/[id]/plus-one');
              }}
              testID="plus-one"
            />
          ) : null}
          {v.plusOne ? (
            <Text tone="muted">
              {v.plusOne.person
                ? t('events.plusOneOf', { name: v.plusOne.person.displayName })
                : t('events.plusOneGuest')}
            </Text>
          ) : null}
          {guestLink ? (
            <TextField
              label={t('events.plusOneShareTitle')}
              value={guestLink}
              editable={false}
              selectTextOnFocus
              hint={t('events.plusOneShare', { url: '' })}
            />
          ) : null}

          {holdsSeat && open ? (
            <>
              <Button
                label={t('events.ticket')}
                variant="secondary"
                onPress={() => {
                  go('/events/[id]/ticket');
                }}
                testID="open-ticket"
              />
              {v.canCheckIn ? (
                <Button
                  label={t('events.checkIn')}
                  loading={checkIn.isPending}
                  onPress={() => void selfCheckIn()}
                  testID="self-check-in"
                />
              ) : null}
            </>
          ) : null}
          {(v.rsvp === 'going' || v.rsvp === 'waitlisted' || v.rsvp === 'interested') &&
          !isPrimaryHost &&
          open ? (
            <Button
              label={t('events.cancelRsvp')}
              variant="ghost"
              onPress={confirmLeave}
              testID="leave"
            />
          ) : null}

          {notice ? (
            <Text tone="primary" accessibilityLiveRegion="polite">
              {notice}
            </Text>
          ) : null}
          {error ? (
            <Text tone="danger" accessibilityLiveRegion="assertive" testID="event-error">
              {error}
            </Text>
          ) : null}

          <View style={styles.row}>
            <Button
              label={t('events.share')}
              variant="secondary"
              onPress={share}
              style={styles.grow}
              testID="share"
            />
            {event.viewer.isHost || event.visibility !== 'invite_only' ? (
              <Button
                label={t('share.shareStory')}
                variant="secondary"
                onPress={() => {
                  router.push({ pathname: '/events/[id]/story', params: { id: event.id } });
                }}
                testID="share-story"
              />
            ) : null}
            {open && (v.isHost || holdsSeat) ? (
              <Button
                label={t('events.invite')}
                variant="secondary"
                onPress={() => {
                  go('/events/[id]/invite');
                }}
                style={styles.grow}
                testID="invite"
              />
            ) : null}
          </View>
        </View>
      </FadeIn>

      {/* 3. This plan's chat and at-the-plan tools, right under Pull up. */}
      {afterRsvp ? <FadeIn delay={140}>{afterRsvp}</FadeIn> : null}

      {/* 4. Everything else about the plan. */}
      <FadeIn delay={200}>
        <View style={styles.wrap} testID="event-details">
          {event.description ? <Text>{event.description}</Text> : null}
          {event.crew ? (
            <Button
              label={t('crews.sessionOf', { name: event.crew.name })}
              variant="ghost"
              onPress={() => {
                if (event.crew)
                  router.push({ pathname: '/crews/[id]', params: { id: event.crew.id } });
              }}
              testID="event-crew"
            />
          ) : null}
          {holdsSeat || v.isHost || v.rsvp === 'interested' ? (
            <CalendarButton event={event} />
          ) : null}
          {liveLocation && (holdsSeat || v.isHost) && canShareFor(event, Date.now()) ? (
            <Button
              label={t('safety.shareTitle')}
              variant="secondary"
              onPress={() => {
                router.push({ pathname: '/safety/share', params: { eventId: event.id } });
              }}
              testID="event-share-location"
            />
          ) : null}
          <MapView
            style={[styles.map, { borderRadius: theme.radii.md }]}
            accessibilityLabel={locationLabel(t, loc)}
            region={{
              latitude: loc.kind === 'exact' ? loc.point.lat : loc.center.lat,
              longitude: loc.kind === 'exact' ? loc.point.lng : loc.center.lng,
              latitudeDelta: loc.kind === 'exact' ? 0.01 : 0.06,
              longitudeDelta: loc.kind === 'exact' ? 0.01 : 0.06,
            }}
            scrollEnabled={false}
            testID="event-map"
          >
            {loc.kind === 'exact' ? (
              <Marker coordinate={{ latitude: loc.point.lat, longitude: loc.point.lng }} />
            ) : (
              <Circle
                center={{ latitude: loc.center.lat, longitude: loc.center.lng }}
                radius={loc.radiusMeters}
                strokeColor={theme.colors.primary}
                fillColor="rgba(20,106,37,0.15)"
              />
            )}
          </MapView>
          <Text tone="muted">
            {[
              event.pricePaise === 0 ? t('events.free') : null,
              event.soloFriendly ? t('events.soloPercent', { pct: event.soloPercent }) : null,
              event.smallGroup ? t('events.smallGroup') : null,
              t(`events.visibility.${event.visibility}`),
              event.indoor ? t('events.indoor') : null,
              event.accessibility.stepFree ? t('events.stepFree') : null,
              event.accessibility.accessibleRestroom ? t('events.accessibleRestroom') : null,
              event.accessibility.quietSpace ? t('events.quietSpace') : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </Text>

          {event.perks.length > 0 ? (
            <View style={styles.wrap} testID="event-perks">
              <Text variant="heading" accessibilityRole="header">
                {t('perks.title')}
              </Text>
              {event.perks.map((p) => (
                <View key={p.perk.id} style={styles.perk}>
                  <Text variant="label">{p.perk.title}</Text>
                  <Text tone="muted">
                    {[
                      p.venueName,
                      p.perk.minGroupSize > 1
                        ? t('perks.groupMin', { count: p.perk.minGroupSize })
                        : null,
                      p.redeemedAt
                        ? t('perks.redeemed', { time: formatTime(p.redeemedAt, i18n.language) })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  {p.canRedeem ? (
                    <Button
                      label={t('perks.redeem')}
                      variant="secondary"
                      onPress={() => {
                        router.push({
                          pathname: '/events/[id]/perk',
                          params: { id: event.id, perkId: p.perk.id },
                        });
                      }}
                      testID={`redeem-${p.perk.id}`}
                    />
                  ) : p.reason && p.reason !== 'ALREADY_REDEEMED' ? (
                    <Text variant="caption" tone="muted">
                      {t(`events.reasons.${p.reason}`)}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          <Text variant="heading" accessibilityRole="header">
            {t('events.hosts')}
          </Text>
          {event.hosts.map((h) => (
            <PersonRow
              key={h.person.id}
              person={h.person}
              detail={
                h.role === 'host'
                  ? null
                  : h.role === 'co_host'
                    ? t('events.cohost')
                    : t('events.welcomeHost')
              }
              onOpen={() => {
                router.push({ pathname: '/users/[id]', params: { id: h.person.id } });
              }}
            />
          ))}
          {event.lore ? (
            <Button
              label={
                event.lore.count > 0
                  ? t('after.seeLore', { count: event.lore.count })
                  : t('lore.title')
              }
              variant="secondary"
              onPress={() => {
                router.push({ pathname: '/events/[id]/lore', params: { id: event.id } });
              }}
              testID="open-lore"
            />
          ) : null}
          {event.status === 'completed' && v.rsvp === 'checked_in' && !v.isHost ? (
            <Button
              label={t('after.title')}
              variant="secondary"
              onPress={() => {
                router.push({ pathname: '/after/[id]', params: { id: event.id } });
              }}
              testID="open-after"
            />
          ) : null}
          {event.status === 'completed' && v.isHost ? (
            <Button
              label={t('after.feedbackTitle')}
              variant="secondary"
              onPress={() => {
                router.push({ pathname: '/events/[id]/feedback', params: { id: event.id } });
              }}
              testID="open-feedback"
            />
          ) : null}
          <Button
            label={t('events.whoIsGoing')}
            variant="ghost"
            onPress={() => {
              go('/events/[id]/attendees');
            }}
            testID="who-is-going"
          />

          {v.isHost && open ? (
            <>
              <Text variant="heading" accessibilityRole="header">
                {t('events.hostTools')}
              </Text>
              {event.visibility === 'approval' && v.hostRole !== 'welcome_host' ? (
                <Button
                  label={t('events.joinRequests', { count: pendingRequests })}
                  variant={pendingRequests > 0 ? 'primary' : 'secondary'}
                  onPress={() => {
                    go('/events/[id]/requests');
                  }}
                  testID="join-requests"
                />
              ) : null}
              <Button
                label={t('events.scan')}
                variant="secondary"
                onPress={() => {
                  go('/events/[id]/scan');
                }}
                testID="scan"
              />
              {v.hostRole !== 'welcome_host' ? (
                <Button
                  label={t('events.edit')}
                  variant="secondary"
                  onPress={() => {
                    router.push({ pathname: '/plot', params: { id: event.id } });
                  }}
                  testID="edit"
                />
              ) : null}
              {isPrimaryHost ? (
                <Button
                  label={t('events.cancelEvent')}
                  variant="danger"
                  onPress={() => {
                    router.push({ pathname: '/events/[id]/cancel', params: { id: event.id } });
                  }}
                  testID="cancel-event"
                />
              ) : null}
            </>
          ) : null}
          {!v.isHost ? (
            <Button
              label={t('report.title')}
              variant="ghost"
              onPress={() => {
                router.push({
                  pathname: '/report',
                  params: { targetType: 'event', targetId: event.id, name: event.title },
                });
              }}
            />
          ) : null}
        </View>
      </FadeIn>
    </View>
  );
}

const styles = StyleSheet.create({
  popStart: { alignSelf: 'flex-start' },
  wrap: { gap: 12 },
  cover: { width: '100%', aspectRatio: 1.6 },
  hero: { borderWidth: 1, padding: 12, gap: 8, overflow: 'hidden' },
  map: { height: 180 },
  banner: { gap: 8, padding: 12, borderWidth: 2 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  grow: { flexGrow: 1 },
  perk: { gap: 4 },
});
