import { type EventSummary, LIMITS } from '@touchgrass/shared';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Linking from 'expo-linking';
import { Share, StyleSheet, View } from 'react-native';
import { ChipGroup } from '../../../components/ChipGroup';
import { SosButton } from '../../../components/SosButton';
import { Button, EmptyState, ErrorState, LoadingState, Screen, Text } from '../../../components/ui';
import { useMyEvents } from '../../../src/features/events/api';
import { formatTime } from '../../../src/features/events/format';
import {
  useLiveShare,
  useSendPoint,
  useStartShare,
  useStopShare,
  useTrustedContacts,
} from '../../../src/features/safety/api';
import { toPoint } from '../../../src/features/safety/sos';
import { errorMessage } from '../../../src/lib/errors';

const NO_PLAN = 'none';
/** How often the phone reports while the app is open (and the minimum move between reports). */
const UPDATE_MS = 30_000;
const UPDATE_METRES = 25;

function inWindow(e: EventSummary, now: number): boolean {
  return (
    e.status !== 'cancelled' &&
    now >= new Date(e.startsAt).getTime() - LIMITS.safety.eventWindowBeforeMs &&
    now <= new Date(e.endsAt).getTime() + LIMITS.safety.eventWindowAfterMs
  );
}

/** Keeps the share fed with fixes while this screen is open and location is allowed. */
function useLocationUpdates(
  active: boolean,
  onFix: (coords: Location.LocationObjectCoords) => void,
): boolean | null {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const latest = useRef(onFix);
  latest.current = onFix;
  useEffect(() => {
    if (!active) return;
    let sub: Location.LocationSubscription | null = null;
    let cancelled = false;
    const isCancelled = (): boolean => cancelled;
    void (async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (isCancelled()) return;
      setAllowed(permission.granted);
      if (!permission.granted) return;
      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: UPDATE_MS,
          distanceInterval: UPDATE_METRES,
        },
        (pos) => {
          latest.current(pos.coords);
        },
      );
      if (isCancelled()) sub.remove();
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [active]);
  return allowed;
}

/** Share live location (F-SAF-04): with trusted contacts, optionally for a plan, for a set time; SOS. */
export default function ShareLocationScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ eventId?: string }>();
  const contacts = useTrustedContacts();
  const live = useLiveShare();
  const plans = useMyEvents('upcoming');
  const start = useStartShare();
  const stop = useStopShare();
  const point = useSendPoint();
  const [minutes, setMinutes] = useState<number>(60);
  const [eventId, setEventId] = useState<string>(params.eventId ?? NO_PLAN);
  const [error, setError] = useState<string | null>(null);
  const share = live.data?.share ?? null;
  const active = share?.active ?? false;
  const allowed = useLocationUpdates(active, (coords) => {
    point.mutate(toPoint(coords));
  });

  if (contacts.isPending || live.isPending) return <LoadingState />;
  if (contacts.isError || live.isError)
    return (
      <ErrorState
        message={errorMessage(t, contacts.error ?? live.error) ?? undefined}
        onRetry={() => {
          void contacts.refetch();
          void live.refetch();
        }}
      />
    );

  const sosButton = <SosButton testID="share-sos" />;

  if (contacts.data.items.length === 0)
    return (
      <Screen testID="share-screen">
        <EmptyState title={t('safety.noContacts')} body={t('safety.contactsBody')} />
        <Button
          label={t('safety.addContact')}
          onPress={() => {
            router.push('/safety/contacts');
          }}
          testID="share-add-contact"
        />
        {sosButton}
      </Screen>
    );

  if (share && active) {
    const message = t('safety.whatsAppMessage', { url: share.link });
    return (
      <Screen testID="share-screen">
        <Text variant="heading" accessibilityRole="header" testID="share-active">
          {t('safety.sharing')}
        </Text>
        <Text>
          {t('safety.sharingUntil', { time: formatTime(share.expiresAt, i18n.language) })}
        </Text>
        <Text testID="share-sent">{t('safety.sharedWith', { count: share.contactsNotified })}</Text>
        <Text tone="muted" testID="share-last-update">
          {share.lastPointAt
            ? t('safety.lastUpdate', { time: formatTime(share.lastPointAt, i18n.language) })
            : t('safety.noUpdateYet')}
        </Text>
        {allowed === false ? (
          <Text tone="danger" accessibilityRole="alert" testID="share-location-denied">
            {t('safety.locationDenied')}
          </Text>
        ) : (
          <Text variant="caption" tone="muted">
            {t('safety.foregroundNote')}
          </Text>
        )}
        <Button
          label={t('safety.sendWhatsApp')}
          variant="secondary"
          onPress={() => {
            void Linking.openURL(`whatsapp://send?text=${encodeURIComponent(message)}`).catch(() =>
              Share.share({ message }),
            );
          }}
          testID="share-whatsapp"
        />
        <Button
          label={t('safety.stop')}
          variant="secondary"
          loading={stop.isPending}
          onPress={() => {
            stop.mutate();
          }}
          testID="share-stop"
        />
        {sosButton}
      </Screen>
    );
  }

  const now = Date.now();
  const options = (plans.data?.pages.flatMap((p) => p.items) ?? []).filter((e) => inWindow(e, now));
  const begin = async (): Promise<void> => {
    setError(null);
    try {
      await start.mutateAsync({ minutes, eventId: eventId === NO_PLAN ? null : eventId });
    } catch (err) {
      setError(errorMessage(t, err));
    }
  };
  return (
    <Screen testID="share-screen">
      {stop.isSuccess ? (
        <Text tone="primary" accessibilityLiveRegion="polite" testID="share-ended">
          {t('safety.ended')}
        </Text>
      ) : null}
      <Text>{t('safety.shareBody')}</Text>
      <ChipGroup
        label={t('safety.shareFor')}
        mode="single"
        options={LIMITS.safety.shareDurations.map((m) => ({
          id: String(m),
          label: t(`safety.durations.m${String(m)}` as 'safety.durations.m60'),
        }))}
        selected={[String(minutes)]}
        onChange={(ids) => {
          const next = Number(ids[0]);
          if (next) setMinutes(next);
        }}
        testIDPrefix="duration"
      />
      <ChipGroup
        label={t('safety.shareTitle')}
        mode="single"
        options={[
          { id: NO_PLAN, label: t('safety.noPlan') },
          ...options.map((e) => ({ id: e.id, label: t('safety.forPlan', { title: e.title }) })),
        ]}
        selected={[eventId]}
        onChange={(ids) => {
          setEventId(ids[0] ?? NO_PLAN);
        }}
        testIDPrefix="plan"
      />
      {error ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="share-error">
          {error}
        </Text>
      ) : null}
      <Button
        label={t('safety.start')}
        loading={start.isPending}
        onPress={() => void begin()}
        testID="share-start"
      />
      <View style={styles.gap} />
      {sosButton}
    </Screen>
  );
}

const styles = StyleSheet.create({
  gap: { height: 8 },
});
