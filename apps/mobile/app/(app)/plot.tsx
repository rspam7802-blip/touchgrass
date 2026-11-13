import { MapPin } from '../../components/icons';
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
import { ScrollView, StyleSheet, View } from 'react-native';
import MapView, { Marker, type MapPressEvent } from 'react-native-maps';
import { ChipGroup } from '../../components/ChipGroup';
import { DateField, TimeField } from '../../components/DateTimeFields';
import { SegmentedTabs } from '../../components/SegmentedTabs';
import {
  Button,
  Card,
  Chip,
  ErrorState,
  FadeIn,
  IconText,
  ListRow,
  LoadingState,
  Screen,
  staggerDelay,
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
/** At most this many place suggestions show while typing. */
const SUGGESTIONS_MAX = 5;
const VISIBILITIES: EventVisibility[] = [
  'public',
  'friends_of_friends',
  'invite_only',
  'approval',
  'women_only',
  'men_only',
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
  /** Free or paid (paid only for approved hosts). */
  paid: boolean;
  /** Ticket price in rupees (text), '0' for free. */
  price: string;
  refundKind: 'full' | 'partial' | 'none';
  cutoffHours: string;
  partialPct: string;
  /** Group chat for people pulling up (D-156). */
  chatEnabled: boolean;
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
    paid: false,
    price: '0',
    refundKind: 'full',
    cutoffHours: '24',
    partialPct: '50',
    chatEnabled: true,
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
    paid: e.pricePaise > 0,
    price: String(e.pricePaise / 100),
    refundKind: e.refundPolicy?.kind ?? 'full',
    cutoffHours: String(e.refundPolicy?.cutoffHours ?? 24),
    partialPct: String(e.refundPolicy?.partialPct ?? 50),
    chatEnabled: e.chatEnabled,
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
  // One key for this form: a second tap (or a retry after a lost response) returns the same plan.
  const [createKey] = useState(() => `plot-${Crypto.randomUUID()}`);
  const create = useCreateEvent(createKey);
  const [leaving, setLeaving] = useState(false);
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
  const [changingPlace, setChangingPlace] = useState(false);
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
    setChangingPlace(false);
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
      chatEnabled: form.chatEnabled,
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
        setLeaving(true);
        const created = await create.mutateAsync(parsed.data);
        // The plan exists now; a failed squad invite must not keep the person on the form (a second tap
        // would look like it creates another plan), so it becomes a notice on the plan instead.
        const inviteFailed = inviteUserId
          ? await client
              .request(`/v1/events/${created.id}/invites`, InviteUsersResult, {
                method: 'POST',
                body: { userIds: [inviteUserId] },
              })
              .then(
                () => false,
                () => true,
              )
          : false;
        router.replace({
          pathname: '/events/[id]',
          params: inviteFailed ? { id: created.id, notice: 'inviteFailed' } : { id: created.id },
        });
      }
    } catch (err) {
      setLeaving(false);
      setFormError(errorMessage(t, err));
    }
  };

  /** Price and refund policy (F-PAY-01/02): only approved hosts sell tickets. */
  function pricing(): Record<string, unknown> {
    if (!canSell) return {};
    const pricePaise = form.paid ? Math.round(Number(form.price || '0') * 100) : 0;
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
  const pricePaise = form.paid ? Math.round(Number(form.price || '0') * 100) : 0;
  const hostShare =
    canSell && pricePaise > 0 && host.data
      ? feeBreakdown(pricePaise, host.data.platformFeeBps, host.data.gstBps).hostNetPaise
      : null;

  // One short list of suggestions for what was typed (D-157): known venues first, then map places, at most 5.
  const typing = query.trim().length >= 2;
  const suggestions: {
    key: string;
    label: string;
    detail: string;
    testID?: string;
    onPick: () => void;
  }[] = [
    ...(search.data?.venues ?? []).map((v) => ({
      key: `v-${v.id}`,
      label: v.name,
      detail: v.address,
      onPick: () => {
        choose({ where: { venueId: v.id }, label: v.name });
      },
    })),
    ...(search.data?.places ?? []).map((p) => ({
      key: `p-${p.placeId}`,
      label: p.primaryText,
      detail: p.secondaryText,
      testID: `place-${p.placeId}`,
      onPick: () => {
        void fromPlace.mutateAsync({ placeId: p.placeId, sessionToken: session }).then(
          (v) => {
            choose({ where: { venueId: v.id }, label: v.name });
          },
          (err: unknown) => {
            setErrors((e) => ({ ...e, where: errorMessage(t, err) ?? '' }));
          },
        );
      },
    })),
  ].slice(0, SUGGESTIONS_MAX);

  const categoryOptions = (interests.data?.items ?? []).map((i) => ({
    id: i.id,
    label: localized(i.name, i18n.language),
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
        scroll
        testIDPrefix="plot-category"
      />
      {errors.categoryId ? <Text tone="danger">{errors.categoryId}</Text> : null}

      <Text variant="heading" accessibilityRole="header">
        {t('events.where')}
      </Text>
      {picked && !changingPlace ? (
        <Card style={styles.picked}>
          <IconText icon={MapPin} testID="plot-picked" accessibilityLiveRegion="polite">
            {picked.label}
          </IconText>
          <Button
            label={t('events.changePlace')}
            variant="ghost"
            onPress={() => {
              setChangingPlace(true);
            }}
            testID="plot-change-place"
          />
        </Card>
      ) : (
        <>
          <TextField
            label={t('events.searchPlace')}
            placeholder={t('events.searchPlaceHint')}
            value={query}
            onChangeText={setQuery}
            error={errors.where || null}
            testID="plot-place-search"
          />
          {typing ? (
            <Card style={styles.suggestions} testID="plot-suggestions">
              {search.isFetching && suggestions.length === 0 ? (
                <Text
                  tone="muted"
                  variant="caption"
                  testID="plot-place-searching"
                  accessibilityLiveRegion="polite"
                >
                  {t('events.searchingPlaces')}
                </Text>
              ) : search.isError ? (
                <Text
                  tone="danger"
                  variant="caption"
                  accessibilityRole="alert"
                  testID="plot-place-error"
                >
                  {errorMessage(t, search.error) ?? t('events.searchFailed')}
                </Text>
              ) : search.data && suggestions.length === 0 ? (
                <Text
                  tone="muted"
                  variant="caption"
                  testID="plot-place-empty"
                  accessibilityLiveRegion="polite"
                >
                  {t('events.noPlaces', { q: query.trim() })}
                </Text>
              ) : null}
              {suggestions.map((sug, i) => (
                <FadeIn key={sug.key} delay={staggerDelay(i, 35)} distance={6}>
                  <ListRow
                    label={sug.label}
                    detail={sug.detail}
                    testID={sug.testID}
                    onPress={sug.onPick}
                  />
                </FadeIn>
              ))}
            </Card>
          ) : (saved.data?.items.length ?? 0) > 0 ? (
            <>
              <Text variant="label" tone="muted">
                {t('events.savedVenues')}
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.chipRow}
              >
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
              </ScrollView>
            </>
          ) : null}
          <Button
            label={t('events.pickOnMap')}
            variant="ghost"
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
        </>
      )}

      <Text variant="heading" accessibilityRole="header">
        {t('events.when')}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
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
      </ScrollView>
      <View style={styles.pair}>
        <View style={styles.half}>
          <DateField
            label={t('events.dateLabel')}
            value={form.date}
            onChange={(v) => {
              set('date', v);
            }}
            error={errors.date || errors.startsAt || null}
            testID="plot-date"
          />
        </View>
        <View style={styles.half}>
          <TimeField
            label={t('events.timeLabel')}
            value={form.time}
            onChange={(v) => {
              set('time', v);
            }}
            testID="plot-time"
          />
        </View>
      </View>
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
      <SegmentedTabs
        tabs={[
          { key: 'free', label: t('events.free') },
          ...(canSell ? [{ key: 'paid' as const, label: t('events.paid') }] : []),
        ]}
        value={form.paid ? 'paid' : 'free'}
        onChange={(k) => {
          set('paid', k === 'paid');
        }}
      />
      {!canSell ? (
        <Text variant="caption" tone="muted" testID="plot-paid-hint">
          {t('events.paidNeedsHost')}
        </Text>
      ) : null}
      {canSell && form.paid ? (
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
                scroll
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
        scroll
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

      <SwitchRow
        label={t('events.chatToggle')}
        hint={t('events.chatToggleHint')}
        value={form.chatEnabled}
        onChange={(v) => {
          set('chatEnabled', v);
        }}
        testID="plot-chat"
      />

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
              label: localized(v.name, i18n.language),
            }))}
            selected={form.vibeTagIds}
            onChange={(ids) => {
              set('vibeTagIds', ids);
            }}
            mode="multi"
            max={5}
            scroll
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
        loading={leaving || create.isPending || update.isPending}
        onPress={() => void submit()}
        testID="plot-submit"
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chipRow: { gap: 8, paddingRight: 8 },
  picked: { gap: 4 },
  suggestions: { gap: 0, paddingVertical: 6 },
  pair: { flexDirection: 'row', gap: 12 },
  half: { flex: 1 },
  mapWrap: { gap: 12 },
  map: { height: 260 },
});
