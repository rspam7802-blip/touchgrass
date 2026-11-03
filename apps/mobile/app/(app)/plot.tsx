import {
  CreateEventBody,
  type EventDetail,
  type EventVisibility,
  type EventWhere,
  feeBreakdown,
  InviteUsersResult,
  type GeoPoint,
  LIMITS,
  UpdateEventBody,
} from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApi } from '../../src/providers/api-context';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, type MapPressEvent } from 'react-native-maps';
import { ChipGroup } from '../../components/ChipGroup';
import {
  Button,
  Chip,
  ErrorState,
  ListRow,
  LoadingState,
  Screen,
  SwitchRow,
  Text,
  TextField,
} from '../../components/ui';
import { localized, useInterests, useVibeTags } from '../../src/features/catalog/api';
import {
  useCreateEvent,
  useEvent,
  useSavedVenues,
  useUpdateEvent,
  useVenueFromPlace,
  useVenueSearch,
} from '../../src/features/events/api';
import { isoToIst, istToIso, quickPick } from '../../src/features/events/format';
import { useHostStatus } from '../../src/features/payments/api';
import { money } from '../../src/features/payments/format';
import { errorMessage } from '../../src/lib/errors';
import { useTheme } from '../../src/theme/theme';

const HYDERABAD: GeoPoint = { lat: 17.385, lng: 78.4867 };
const VISIBILITIES: EventVisibility[] = [
  'public',
  'friends_of_friends',
  'invite_only',
  'women_only',
  'balanced',
];

interface Picked {
  where: EventWhere;
  label: string;
}

interface FormState {
  title: string;
  description: string;
  categoryId: string | null;
  vibeTagIds: string[];
  date: string;
  time: string;
  durationHours: string;
  capacity: string;
  visibility: EventVisibility;
  balancedPct: number;
  soloFriendly: boolean;
  smallGroup: boolean;
  mystery: boolean;
  revealHours: number;
  allowPlusOnes: boolean;
  indoor: boolean;
  stepFree: boolean;
  accessibleRestroom: boolean;
  quietSpace: boolean;
  /** Ticket price in rupees (text), '0' for free. */
  price: string;
  refundKind: 'full' | 'partial' | 'none';
  cutoffHours: string;
  partialPct: string;
}

function initialState(): FormState {
  const pick = quickPick('tomorrow');
  return {
    title: '',
    description: '',
    categoryId: null,
    vibeTagIds: [],
    date: pick.date,
    time: pick.time,
    durationHours: '2',
    capacity: '8',
    visibility: 'public',
    balancedPct: 60,
    soloFriendly: true,
    smallGroup: false,
    mystery: false,
    revealHours: 2,
    allowPlusOnes: false,
    indoor: false,
    stepFree: false,
    accessibleRestroom: false,
    quietSpace: false,
    price: '0',
    refundKind: 'full',
    cutoffHours: '24',
    partialPct: '50',
  };
}

function fromEvent(e: EventDetail): FormState {
  const start = isoToIst(e.startsAt);
  const hours = (new Date(e.endsAt).getTime() - new Date(e.startsAt).getTime()) / 3_600_000;
  return {
    title: e.title,
    description: e.description,
    categoryId: e.category?.id ?? null,
    vibeTagIds: e.vibeTags.map((v) => v.id),
    date: start.date,
    time: start.time,
    durationHours: String(Math.round(hours * 10) / 10),
    capacity: String(e.capacity),
    visibility: e.visibility,
    balancedPct: e.balancedMaxSharePct ?? 60,
    soloFriendly: e.soloFriendly,
    smallGroup: e.smallGroup,
    mystery: e.mystery,
    revealHours: 2,
    allowPlusOnes: e.allowPlusOnes,
    indoor: e.indoor,
    stepFree: e.accessibility.stepFree,
    accessibleRestroom: e.accessibility.accessibleRestroom,
    quietSpace: e.accessibility.quietSpace,
    price: String(e.pricePaise / 100),
    refundKind: e.refundPolicy?.kind ?? 'full',
    cutoffHours: String(e.refundPolicy?.cutoffHours ?? 24),
    partialPct: String(e.refundPolicy?.partialPct ?? 50),
  };
}

/** Plot a plan (F-EVT-01/02): what, where, when, who, plus the advanced options. Also edits (F-EVT-16). */
export default function PlotScreen() {
  const { id, venueId, venueName, inviteUserId } = useLocalSearchParams<{
    id?: string;
    venueId?: string;
    venueName?: string;
    /** "Plan with them" from the free-now strip (F-ENG-01): invited as soon as the plan exists. */
    inviteUserId?: string;
  }>();
  if (id) return <EditLoader id={id} />;
  // Plotting from a place found in search starts with that place picked.
  const initialPick = venueId && venueName ? { where: { venueId }, label: venueName } : null;
  return <PlotForm existing={null} initialPick={initialPick} inviteUserId={inviteUserId ?? null} />;
}

function EditLoader({ id }: { id: string }) {
  const { t } = useTranslation();
  const q = useEvent(id);
  if (q.isPending) return <LoadingState />;
  if (q.isError)
    return (
      <ErrorState
        message={errorMessage(t, q.error) ?? undefined}
        onRetry={() => void q.refetch()}
      />
    );
  return <PlotForm existing={q.data} initialPick={null} />;
}

function PlotForm({
  existing,
  initialPick,
  inviteUserId = null,
}: {
  existing: EventDetail | null;
  initialPick: Picked | null;
  inviteUserId?: string | null;
}) {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const theme = useTheme();
  const interests = useInterests();
  const vibes = useVibeTags();
  const saved = useSavedVenues();
  const create = useCreateEvent();
  const { client } = useApi();
  const update = useUpdateEvent(existing?.id ?? '');
  const fromPlace = useVenueFromPlace();
  const host = useHostStatus();
  const canSell = host.data?.canHostPaid === true || (existing?.pricePaise ?? 0) > 0;
  const [form, setForm] = useState<FormState>(() =>
    existing ? fromEvent(existing) : initialState(),
  );
  const [picked, setPicked] = useState<Picked | null>(
    existing?.location.kind === 'exact'
      ? {
          where: {
            point: existing.location.point,
            address: existing.location.address,
            placeName: existing.location.placeName,
          },
          label: existing.location.placeName ?? existing.location.address,
        }
      : initialPick,
  );
  const [whereChanged, setWhereChanged] = useState(false);
  const [query, setQuery] = useState('');
  const [near, setNear] = useState<GeoPoint>(HYDERABAD);
  const [mapOpen, setMapOpen] = useState(false);
  const [pin, setPin] = useState<GeoPoint | null>(null);
  const [pinAddress, setPinAddress] = useState('');
  const [advanced, setAdvanced] = useState(existing !== null);
  // Edits only send the reveal time when the host changed it (the detail view does not expose it).
  const [revealTouched, setRevealTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const session = useMemo(() => Crypto.randomUUID(), []);
  const search = useVenueSearch(query, near, session);

  useEffect(() => {
    void (async () => {
      const perm = await Location.getForegroundPermissionsAsync();
      if (!perm.granted) return;
      const pos = await Location.getLastKnownPositionAsync();
      if (pos) setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude });
    })();
  }, []);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };
  const choose = (p: Picked): void => {
    setPicked(p);
    setWhereChanged(true);
    setQuery('');
    setMapOpen(false);
    setErrors((e) => ({ ...e, where: '' }));
  };

  const submit = async (): Promise<void> => {
    setFormError(null);
    const startsAt = istToIso(form.date, form.time);
    const hours = Number(form.durationHours);
    if (!startsAt) {
      setErrors({ date: t('events.dateLabel') });
      return;
    }
    if (!picked) {
      setErrors({ where: t('events.pickPlace') });
      return;
    }
    const endsAt = new Date(
      new Date(startsAt).getTime() + (Number.isFinite(hours) ? hours : 0) * 3_600_000,
    ).toISOString();
    const fields = {
      title: form.title,
      description: form.description,
      ...(form.categoryId ? { categoryInterestId: form.categoryId } : {}),
      vibeTagIds: form.vibeTagIds,
      startsAt,
      endsAt,
      capacity: Number(form.capacity),
      ...pricing(),
      visibility: form.visibility,
      balancedMaxSharePct: form.visibility === 'balanced' ? form.balancedPct : null,
      soloFriendly: form.soloFriendly,
      smallGroup: form.smallGroup,
      mystery: form.mystery,
      ...(existing && !revealTouched ? {} : { mysteryRevealMinutesBefore: form.revealHours * 60 }),
      // Paid plans have no +1s: every seat is a ticket.
      allowPlusOnes: canSell && pricePaise > 0 ? false : form.allowPlusOnes,
      indoor: form.indoor,
      accessibility: {
        stepFree: form.stepFree,
        accessibleRestroom: form.accessibleRestroom,
        quietSpace: form.quietSpace,
      },
    };
    const showIssues = (
      issues: readonly { path: readonly PropertyKey[]; message: string }[],
    ): void => {
      const next: Record<string, string> = {};
      for (const issue of issues) {
        const key = String(issue.path[0] ?? 'form');
        next[key === 'categoryInterestId' ? 'categoryId' : key] = issue.message;
      }
      setErrors(next);
    };
    try {
      if (existing) {
        const parsed = UpdateEventBody.safeParse({
          ...fields,
          ...(whereChanged ? { where: picked.where } : {}),
        });
        if (!parsed.success) {
          showIssues(parsed.error.issues);
          return;
        }
        await update.mutateAsync(parsed.data);
        router.back();
      } else {
        const parsed = CreateEventBody.safeParse({ ...fields, where: picked.where });
        if (!parsed.success) {
          showIssues(parsed.error.issues);
          return;
        }
        const created = await create.mutateAsync(parsed.data);
        if (inviteUserId)
          await client.request(`/v1/events/${created.id}/invites`, InviteUsersResult, {
            method: 'POST',
            body: { userIds: [inviteUserId] },
          });
        router.replace({ pathname: '/events/[id]', params: { id: created.id } });
      }
    } catch (err) {
      setFormError(errorMessage(t, err));
    }
  };

  /** Price and refund policy (F-PAY-01/02): only approved hosts sell tickets. */
  function pricing(): Record<string, unknown> {
    if (!canSell) return {};
    const pricePaise = Math.round(Number(form.price || '0') * 100);
    if (!Number.isFinite(pricePaise) || pricePaise <= 0)
      return { pricePaise: 0, refundPolicy: null };
    return {
      pricePaise,
      allowPlusOnes: false,
      refundPolicy: {
        kind: form.refundKind,
        cutoffHours: Number(form.cutoffHours || '0'),
        partialPct: form.refundKind === 'partial' ? Number(form.partialPct || '0') : null,
      },
    };
  }
  const pricePaise = Math.round(Number(form.price || '0') * 100);
  const hostShare =
    canSell && pricePaise > 0 && host.data
      ? feeBreakdown(pricePaise, host.data.platformFeeBps, host.data.gstBps).hostNetPaise
      : null;

  const categoryOptions = (interests.data?.items ?? []).map((i) => ({
    id: i.id,
    label: `${i.emoji} ${localized(i.name, i18n.language)}`,
  }));

  return (
    <Screen testID="plot-screen">
      <Text variant="title" accessibilityRole="header">
        {existing ? t('events.edit') : t('events.plotTitle')}
      </Text>

      <Text variant="heading" accessibilityRole="header">
        {t('events.what')}
      </Text>
      <TextField
        label={t('events.titleLabel')}
        placeholder={t('events.titlePlaceholder')}
        value={form.title}
        maxLength={LIMITS.event.titleMaxLength}
        onChangeText={(v) => {
          set('title', v);
        }}
        error={errors.title || null}
        testID="plot-title"
      />
      <ChipGroup
        label={t('events.categoryLabel')}
        options={categoryOptions}
        selected={form.categoryId ? [form.categoryId] : []}
        onChange={(ids) => {
          set('categoryId', ids[0] ?? null);
        }}
        mode="single"
        testIDPrefix="plot-category"
      />
      {errors.categoryId ? <Text tone="danger">{errors.categoryId}</Text> : null}

      <Text variant="heading" accessibilityRole="header">
        {t('events.where')}
      </Text>
      {picked ? (
        <Text testID="plot-picked" accessibilityLiveRegion="polite">
          📍 {picked.label}
        </Text>
      ) : null}
      <TextField
        label={t('events.searchPlace')}
        value={query}
        onChangeText={setQuery}
        error={errors.where || null}
        testID="plot-place-search"
      />
      {search.data?.venues.map((v) => (
        <ListRow
          key={v.id}
          label={v.name}
          detail={v.address}
          onPress={() => {
            choose({ where: { venueId: v.id }, label: v.name });
          }}
        />
      ))}
      {search.data?.places.map((p) => (
        <ListRow
          key={p.placeId}
          label={p.primaryText}
          detail={p.secondaryText}
          testID={`place-${p.placeId}`}
          onPress={() => {
            void fromPlace.mutateAsync({ placeId: p.placeId, sessionToken: session }).then(
              (v) => {
                choose({ where: { venueId: v.id }, label: v.name });
              },
              (err: unknown) => {
                setErrors((e) => ({ ...e, where: errorMessage(t, err) ?? '' }));
              },
            );
          }}
        />
      ))}
      {(saved.data?.items.length ?? 0) > 0 ? (
        <>
          <Text variant="label">{t('events.savedVenues')}</Text>
          <View style={styles.chips}>
            {saved.data?.items.map((v) => (
              <Chip
                key={v.id}
                label={v.name}
                kind="radio"
                selected={
                  picked?.where !== undefined &&
                  'venueId' in picked.where &&
                  picked.where.venueId === v.id
                }
                onToggle={() => {
                  choose({ where: { venueId: v.id }, label: v.name });
                }}
              />
            ))}
          </View>
        </>
      ) : null}
      <Button
        label={t('events.pickOnMap')}
        variant="secondary"
        onPress={() => {
          setMapOpen((o) => !o);
        }}
      />
      {mapOpen ? (
        <View style={styles.mapWrap}>
          <MapView
            style={[styles.map, { borderRadius: theme.radii.md }]}
            initialRegion={{
              latitude: near.lat,
              longitude: near.lng,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
            onPress={(e: MapPressEvent) => {
              setPin({
                lat: e.nativeEvent.coordinate.latitude,
                lng: e.nativeEvent.coordinate.longitude,
              });
            }}
            accessibilityLabel={t('events.pickOnMap')}
            testID="plot-map"
          >
            {pin ? <Marker coordinate={{ latitude: pin.lat, longitude: pin.lng }} /> : null}
          </MapView>
          <TextField
            label={t('events.addressLabel')}
            value={pinAddress}
            onChangeText={setPinAddress}
            testID="plot-pin-address"
          />
          <Button
            label={t('events.usePin')}
            disabled={!pin || pinAddress.trim().length < 3}
            onPress={() => {
              if (pin)
                choose({
                  where: { point: pin, address: pinAddress.trim(), placeName: null },
                  label: pinAddress.trim(),
                });
            }}
          />
        </View>
      ) : null}

      <Text variant="heading" accessibilityRole="header">
        {t('events.when')}
      </Text>
      <View style={styles.chips}>
        {(['tonight', 'tomorrow', 'weekend'] as const).map((k) => (
          <Chip
            key={k}
            kind="radio"
            label={t(k === 'weekend' ? 'events.thisWeekend' : `events.${k}`)}
            selected={(() => {
              const p = quickPick(k);
              return p.date === form.date && p.time === form.time;
            })()}
            onToggle={() => {
              const p = quickPick(k);
              setForm((f) => ({ ...f, date: p.date, time: p.time }));
            }}
          />
        ))}
      </View>
      <TextField
        label={t('events.dateLabel')}
        value={form.date}
        onChangeText={(v) => {
          set('date', v);
        }}
        keyboardType="numbers-and-punctuation"
        error={errors.date || errors.startsAt || null}
        testID="plot-date"
      />
      <TextField
        label={t('events.timeLabel')}
        value={form.time}
        onChangeText={(v) => {
          set('time', v);
        }}
        keyboardType="numbers-and-punctuation"
        testID="plot-time"
      />
      <TextField
        label={t('events.durationHours')}
        value={form.durationHours}
        onChangeText={(v) => {
          set('durationHours', v);
        }}
        keyboardType="decimal-pad"
        error={errors.endsAt || null}
      />

      <Text variant="heading" accessibilityRole="header">
        {t('events.who')}
      </Text>
      <TextField
        label={t('events.capacityLabel')}
        value={form.capacity}
        onChangeText={(v) => {
          set('capacity', v.replace(/\D/g, ''));
        }}
        keyboardType="number-pad"
        error={errors.capacity || null}
        testID="plot-capacity"
      />
      {canSell ? (
        <>
          <TextField
            label={t('payments.priceLabel')}
            hint={t('payments.priceHint')}
            value={form.price}
            onChangeText={(v) => {
              set('price', v.replace(/[^\d.]/g, ''));
            }}
            keyboardType="decimal-pad"
            error={errors.pricePaise || null}
            testID="plot-price"
          />
          {hostShare !== null ? (
            <Text tone="muted" testID="plot-host-share">
              {t('payments.youGet', { amount: money(hostShare, i18n.language) })}
            </Text>
          ) : null}
          {pricePaise > 0 ? (
            <>
              <ChipGroup
                label={t('payments.refundPolicyLabel')}
                options={(['full', 'partial', 'none'] as const).map((k) => ({
                  id: k,
                  label: t(`payments.refundKinds.${k}`),
                }))}
                selected={[form.refundKind]}
                onChange={(ids) => {
                  const k = ids[0] as FormState['refundKind'] | undefined;
                  if (k) set('refundKind', k);
                }}
                mode="single"
                testIDPrefix="plot-refund"
              />
              {form.refundKind !== 'none' ? (
                <TextField
                  label={t('payments.cutoffLabel')}
                  value={form.cutoffHours}
                  onChangeText={(v) => {
                    set('cutoffHours', v.replace(/\D/g, ''));
                  }}
                  keyboardType="number-pad"
                  error={errors.refundPolicy || null}
                  testID="plot-cutoff"
                />
              ) : null}
              {form.refundKind === 'partial' ? (
                <TextField
                  label={t('payments.partialPctLabel')}
                  value={form.partialPct}
                  onChangeText={(v) => {
                    set('partialPct', v.replace(/\D/g, ''));
                  }}
                  keyboardType="number-pad"
                  testID="plot-partial-pct"
                />
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
      <ChipGroup
        label={t('events.visibilityLabel')}
        options={VISIBILITIES.map((v) => ({ id: v, label: t(`events.visibility.${v}`) }))}
        selected={[form.visibility]}
        onChange={(ids) => {
          const v = ids[0] as EventVisibility | undefined;
          if (v) set('visibility', v);
        }}
        mode="single"
        testIDPrefix="plot-visibility"
      />
      {form.visibility === 'balanced' ? (
        <View style={styles.chips}>
          {[50, 60, 70].map((pct) => (
            <Chip
              key={pct}
              kind="radio"
              label={t('events.balancedShare', { pct })}
              selected={form.balancedPct === pct}
              onToggle={() => {
                set('balancedPct', pct);
              }}
            />
          ))}
        </View>
      ) : null}

      <Button
        label={t('events.more')}
        variant="ghost"
        onPress={() => {
          setAdvanced((a) => !a);
        }}
        accessibilityState={{ expanded: advanced }}
      />
      {advanced ? (
        <>
          <TextField
            label={t('events.descriptionLabel')}
            value={form.description}
            onChangeText={(v) => {
              set('description', v);
            }}
            multiline
            maxLength={LIMITS.event.descriptionMaxLength}
          />
          <ChipGroup
            label={t('profile.vibes')}
            options={(vibes.data?.items ?? []).map((v) => ({
              id: v.id,
              label: `${v.emoji} ${localized(v.name, i18n.language)}`,
            }))}
            selected={form.vibeTagIds}
            onChange={(ids) => {
              set('vibeTagIds', ids);
            }}
            mode="multi"
            max={5}
            testIDPrefix="plot-vibe"
          />
          <SwitchRow
            label={t('events.soloFriendly')}
            value={form.soloFriendly}
            onChange={(v) => {
              set('soloFriendly', v);
            }}
          />
          <SwitchRow
            label={t('events.smallGroup')}
            value={form.smallGroup}
            onChange={(v) => {
              set('smallGroup', v);
            }}
          />
          <SwitchRow
            label={t('events.mystery')}
            value={form.mystery}
            onChange={(v) => {
              set('mystery', v);
            }}
            testID="plot-mystery"
          />
          {form.mystery ? (
            <View style={styles.chips}>
              {[1, 2, 4, 24].map((h) => (
                <Chip
                  key={h}
                  kind="radio"
                  label={t('events.mysteryReveal', { hours: h })}
                  selected={form.revealHours === h}
                  onToggle={() => {
                    set('revealHours', h);
                    setRevealTouched(true);
                  }}
                />
              ))}
            </View>
          ) : null}
          <SwitchRow
            label={t('events.plusOnes')}
            value={form.allowPlusOnes}
            onChange={(v) => {
              set('allowPlusOnes', v);
            }}
          />
          <SwitchRow
            label={t('events.indoor')}
            value={form.indoor}
            onChange={(v) => {
              set('indoor', v);
            }}
          />
          <SwitchRow
            label={t('events.stepFree')}
            value={form.stepFree}
            onChange={(v) => {
              set('stepFree', v);
            }}
          />
          <SwitchRow
            label={t('events.accessibleRestroom')}
            value={form.accessibleRestroom}
            onChange={(v) => {
              set('accessibleRestroom', v);
            }}
          />
          <SwitchRow
            label={t('events.quietSpace')}
            value={form.quietSpace}
            onChange={(v) => {
              set('quietSpace', v);
            }}
          />
        </>
      ) : null}

      {formError ? (
        <Text tone="danger" accessibilityLiveRegion="assertive" testID="plot-error">
          {formError}
        </Text>
      ) : null}
      <Button
        label={existing ? t('events.save') : t('events.publish')}
        loading={create.isPending || update.isPending}
        onPress={() => void submit()}
        testID="plot-submit"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mapWrap: { gap: 12 },
  map: { height: 260 },
});
