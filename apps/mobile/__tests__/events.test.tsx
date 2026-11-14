import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { EventDetail } from '@touchgrass/shared';
import * as Location from 'expo-location';
import { Share } from 'react-native';
import PlansScreen from '../app/(app)/(tabs)/plans';
import AttendeesScreen from '../app/(app)/events/[id]/attendees';
import CancelEventScreen from '../app/(app)/events/[id]/cancel';
import EventScreen from '../app/(app)/events/[id]/index';
import JoinRequestsScreen from '../app/(app)/events/[id]/requests';
import InviteScreen from '../app/(app)/events/[id]/invite';
import PlusOneScreen from '../app/(app)/events/[id]/plus-one';
import ScanScreen from '../app/(app)/events/[id]/scan';
import TicketScreen from '../app/(app)/events/[id]/ticket';
import PlotScreen from '../app/(app)/plot';
import ClaimRoute from '../app/claim/[token]';
import SharedEventRoute from '../app/e/[slug]';
import { istToIso, isoToIst, quickPick } from '../src/features/events/format';
import { useAuthFlowStore } from '../src/stores/auth-flow-store';
import { useAuthStore } from '../src/stores/auth-store';
import {
  authResponseFixture,
  FakeApi,
  ids,
  interestsFixture,
  vibesFixture,
} from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const EVENT_ID = '0192f3a4-5b6c-7d8e-9f01-00000000e001';
const person = (id: string, displayName: string) => ({
  id,
  displayName,
  photo: null,
  verified: true,
  mutualFriendCount: 0,
});
const host = person(ids.other, 'Rohan K.');
const me = person(ids.me, 'Priya R.');

function eventFixture(
  overrides: Partial<EventDetail> = {},
  viewer: Partial<EventDetail['viewer']> = {},
): EventDetail {
  return {
    id: EVENT_ID,
    slug: 'AbCd2345',
    type: 'plan',
    status: 'published',
    title: 'Sunset frisbee',
    cover: null,
    startsAt: '2026-11-03T12:30:00.000Z',
    endsAt: '2026-11-03T14:30:00.000Z',
    timezone: 'Asia/Kolkata',
    location: {
      kind: 'exact',
      point: { lat: 17.4436, lng: 78.3519 },
      address: '42 Lake Road, Gachibowli',
      placeName: 'Lake View Park',
      neighbourhoodName: 'Gachibowli',
    },
    visibility: 'public',
    capacity: 10,
    goingCount: 4,
    spotsLeft: 6,
    waitlistCount: 0,
    pricePaise: 0,
    soloFriendly: true,
    smallGroup: false,
    mystery: false,
    indoor: false,
    accessibility: { stepFree: true, accessibleRestroom: false, quietSpace: false },
    category: null,
    viewer: {
      rsvp: null,
      isHost: false,
      hostRole: null,
      invitedBy: null,
      offer: null,
      plusOne: null,
      waitlistPosition: null,
      canRsvp: true,
      blockedReason: null,
      canCheckIn: false,
      payment: null,
      cooldownUntil: null,
      ...viewer,
    },
    description: 'Bring water.',
    hosts: [{ person: host, role: 'host' }],
    interests: [],
    vibeTags: [],
    minGroupSize: 2,
    allowPlusOnes: true,
    chatEnabled: true,
    balancedMaxSharePct: null,
    soloPercent: 50,
    cancelledReason: null,
    shareUrl: 'http://web.test/e/AbCd2345',
    refundPolicy: null,
    perks: [],
    lore: null,
    crew: null,
    held: false,
    ...overrides,
  };
}

let api: FakeApi;
beforeEach(async () => {
  resetStores();
  await useAuthStore.getState().signIn(
    authResponseFixture({
      user: {
        id: ids.me,
        status: 'active',
        onboardingComplete: true,
        tutorialComplete: true,
        roles: [],
      },
    }) as never,
  );
  mockRouteParams.current = { id: EVENT_ID };
  api = new FakeApi().on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: eventFixture() });
});

/** Sunday 1 Nov 2026, noon IST: only the clock is fixed, timers keep running. */
const TODAY = new Date('2026-11-01T06:30:00.000Z');
function freezeToday(): void {
  jest.useFakeTimers({
    now: TODAY,
    doNotFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
      'nextTick',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'performance',
      'hrtime',
    ],
  });
}

/** Opens the category list and picks the nth fixture interest. */
async function pickCategory(n: number): Promise<void> {
  await fireEvent.press(await screen.findByTestId('plot-category'));
  await fireEvent.press(
    await screen.findByTestId(`plot-category-${interestsFixture[n]?.id ?? ''}`),
  );
}

/** Picks Tuesday 3 Nov 2026, 6:00 pm from the calendar and time sheets. */
async function pickWhen(): Promise<void> {
  await fireEvent.press(screen.getByTestId('plot-date'));
  await fireEvent.press(await screen.findByTestId('plot-date-day-2026-11-03'));
  await fireEvent.press(screen.getByTestId('plot-time'));
  await fireEvent.press(await screen.findByTestId('plot-time-hour-6'));
  await fireEvent.press(screen.getByTestId('plot-time-minute-00'));
  await fireEvent.press(screen.getByTestId('plot-time-pm'));
  await fireEvent.press(screen.getByTestId('plot-time-done'));
}

describe('IST time helpers', () => {
  it('round-trips date and time entered in IST', () => {
    expect(istToIso('03/11/2026', '18:00')).toBe('2026-11-03T12:30:00.000Z');
    expect(isoToIst('2026-11-03T12:30:00.000Z')).toEqual({ date: '03/11/2026', time: '18:00' });
    expect(istToIso('31/02/2026', '18:00')).toBeNull();
    expect(istToIso('03/11/2026', '25:00')).toBeNull();
    expect(istToIso('03/11/2026', 'soon')).toBeNull();
  });
  it('quick picks tonight, tomorrow and the weekend', () => {
    const wedNoonIst = new Date('2026-11-04T06:30:00.000Z');
    expect(quickPick('tonight', wedNoonIst)).toEqual({ date: '04/11/2026', time: '19:00' });
    expect(quickPick('tonight', new Date('2026-11-04T15:00:00.000Z'))).toEqual({
      date: '04/11/2026',
      time: '21:00',
    });
    expect(quickPick('tomorrow', wedNoonIst)).toEqual({ date: '05/11/2026', time: '18:00' });
    expect(quickPick('weekend', wedNoonIst)).toEqual({ date: '07/11/2026', time: '17:00' });
  });
});

describe('Plans tab', () => {
  it('lists my plans by scope and opens Plot', async () => {
    api.on('GET', '/v1/events/mine', (c) => ({
      status: 200,
      body: {
        items: c.path ? [eventFixture({}, { rsvp: 'going', canRsvp: false })] : [],
        nextCursor: null,
      },
    }));
    await renderWithProviders(<PlansScreen />, { fetchFn: api.fetch });
    const card = await screen.findByTestId('event-AbCd2345');
    expect(card.props.accessibilityLabel).toContain("You're pulling up");
    await fireEvent.press(card);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]',
      params: { id: EVENT_ID },
    });
    await fireEvent.press(screen.getByTestId('plot-cta'));
    expect(mockRouter.push).toHaveBeenCalledWith('/plot');
    // Upcoming, hosting and past load together and show as sideways rows (D-158).
    const scopes = api.calls
      .filter((c) => c.path === '/v1/events/mine')
      .map((c) => new URL(c.url).searchParams.get('scope'));
    expect(scopes.sort()).toEqual(['hosting', 'past', 'upcoming']);
    expect(screen.getByTestId('rail-mine-hosting')).toBeOnTheScreen();
    expect(screen.getByTestId('rail-mine-past')).toBeOnTheScreen();
  });

  it('shows the empty state', async () => {
    api.on('GET', '/v1/events/mine', { status: 200, body: { items: [], nextCursor: null } });
    await renderWithProviders(<PlansScreen />, { fetchFn: api.fetch });
    expect(
      await screen.findByText('Nothing planned yet. Plot something or pull up to a plan.'),
    ).toBeOnTheScreen();
  });
});

describe('Event detail', () => {
  it('shows the plan card, then Pull up, then the plan chat, then the details', async () => {
    const going = eventFixture({}, { rsvp: 'going', canRsvp: false });
    api
      .on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: going })
      .on('GET', `/v1/events/${EVENT_ID}/chat`, {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'none' } },
      });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await screen.findByTestId('event-hero');
    const order = ['event-hero', 'event-rsvp', 'together-tools', 'event-details'];
    const tree = JSON.stringify(screen.toJSON());
    const positions = order.map((id) => tree.indexOf(`"testID":"${id}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('pulls up with an idempotency key and shows the new state', async () => {
    const going = eventFixture({ goingCount: 5, spotsLeft: 5 }, { rsvp: 'going', canRsvp: false });
    api.on('PUT', `/v1/events/${EVENT_ID}/rsvp`, () => {
      // The server now reports the new state on every read.
      api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: going });
      return { status: 200, body: { status: 'going', plusOneClaimUrl: null, event: going } };
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Lake View Park · 42 Lake Road, Gachibowli')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('pull-up'));
    await waitFor(() => expect(api.callsTo('PUT', `/v1/events/${EVENT_ID}/rsvp`)).toHaveLength(1));
    const call = api.callsTo('PUT', `/v1/events/${EVENT_ID}/rsvp`)[0];
    expect(call?.body).toEqual({ status: 'going', plusOne: null });
    expect(call?.headers['idempotency-key']).toMatch(/^rsvp-/);
    expect(await screen.findByTestId('rsvp-status')).toHaveTextContent("You're pulling up");
  });

  it('offers a +1 only while pulling up, never on a seat you already hold', async () => {
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('plus-one')).toBeOnTheScreen();
  });

  it('hides the +1 once you are going (the API refuses adding one to a held seat)', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture({}, { rsvp: 'going', canRsvp: false }),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('rsvp-status')).toBeOnTheScreen();
    expect(screen.queryByTestId('plus-one')).toBeNull();
  });

  it('mystery plans show only the area until the reveal', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture(
        {
          mystery: true,
          location: {
            kind: 'approximate',
            center: { lat: 17.45, lng: 78.36 },
            radiusMeters: 2000,
            neighbourhoodName: 'Gachibowli',
            revealsAt: '2026-11-03T10:30:00.000Z',
          },
        },
        { rsvp: 'going', canRsvp: false },
      ),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Mystery spot near Gachibowli')).toBeOnTheScreen();
    expect(screen.getByText(/Exact spot revealed/)).toBeOnTheScreen();
    expect(screen.queryByText(/Lake Road/)).toBeNull();
  });

  it('claims an open waitlist spot', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}`, {
        status: 200,
        body: eventFixture(
          { spotsLeft: 0 },
          {
            rsvp: 'waitlisted',
            waitlistPosition: 1,
            canRsvp: false,
            offer: { expiresAt: '2026-11-03T08:00:00.000Z', mode: 'sequential' },
          },
        ),
      })
      .on('POST', `/v1/events/${EVENT_ID}/waitlist/claim`, {
        status: 200,
        body: {
          status: 'going',
          plusOneClaimUrl: null,
          event: eventFixture({}, { rsvp: 'going', canRsvp: false }),
        },
      });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('A spot is now available.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('claim-spot'));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/waitlist/claim`)).toHaveLength(1),
    );
  });

  it('explains why you cannot pull up using the API reason', async () => {
    api.on('PUT', `/v1/events/${EVENT_ID}/rsvp`, {
      status: 403,
      body: { error: { code: 'NOT_ELIGIBLE', message: 'x', details: { reason: 'WOMEN_ONLY' } } },
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('pull-up'));
    expect(await screen.findByTestId('event-error')).toHaveTextContent(
      'This plan is for verified women.',
    );
  });

  it('private plan: asks the host to join, shows the wait, and hides the spot (D-179)', async () => {
    const hidden = {
      kind: 'approximate' as const,
      center: { lat: 17.45, lng: 78.36 },
      radiusMeters: 2000,
      neighbourhoodName: 'Gachibowli',
      revealsAt: '2026-11-03T10:30:00.000Z',
      hiddenBy: 'approval' as const,
    };
    const closed = { canRsvp: false, blockedReason: 'APPROVAL_REQUIRED' };
    // The server remembers the request, so every refetch after asking shows it as pending.
    let request: 'pending' | null = null;
    const plan = () =>
      eventFixture(
        { visibility: 'approval', location: hidden },
        { ...closed, joinRequest: request },
      );
    api
      .on('GET', `/v1/events/${EVENT_ID}`, () => ({ status: 200, body: plan() }))
      .on('POST', `/v1/events/${EVENT_ID}/join-request`, () => {
        request = 'pending';
        return { status: 200, body: { status: 'pending', event: plan() } };
      })
      .on('DELETE', `/v1/events/${EVENT_ID}/join-request`, () => {
        request = null;
        return { status: 204 };
      });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('event-location-hidden')).toHaveTextContent(
      /shared once the host lets you in/,
    );
    expect(screen.queryByTestId('pull-up')).toBeNull();
    await fireEvent.press(screen.getByTestId('join-ask'));
    expect(await screen.findByTestId('join-pending')).toHaveTextContent(
      'Request sent. The host will let you know.',
    );
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/join-request`)).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('join-withdraw'));
    await waitFor(() =>
      expect(api.callsTo('DELETE', `/v1/events/${EVENT_ID}/join-request`)).toHaveLength(1),
    );
  });

  it('private plan: a declined request says so and offers nothing else', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture(
        { visibility: 'approval' },
        { canRsvp: false, blockedReason: 'APPROVAL_REQUIRED', joinRequest: 'declined' },
      ),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('join-declined')).toBeOnTheScreen();
    expect(screen.queryByTestId('join-ask')).toBeNull();
    expect(screen.queryByTestId('pull-up')).toBeNull();
  });

  it('private plan: the host sees who is waiting and lets them in or not', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}`, {
        status: 200,
        body: eventFixture(
          { visibility: 'approval', pendingJoinRequests: 2 },
          { isHost: true, hostRole: 'host', canRsvp: false, blockedReason: 'HOST' },
        ),
      })
      .on('GET', `/v1/events/${EVENT_ID}/join-requests`, {
        status: 200,
        body: {
          items: [{ person: host, status: 'pending', requestedAt: '2026-11-01T06:00:00.000Z' }],
          nextCursor: null,
        },
      })
      .on('POST', `/v1/events/${EVENT_ID}/join-requests/${ids.other}/approve`, { status: 204 });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('join-requests')).toHaveTextContent('Requests to join (2)');
    await fireEvent.press(screen.getByTestId('join-requests'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/requests',
      params: { id: EVENT_ID },
    });

    await renderWithProviders(<JoinRequestsScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId(`join-approve-${ids.other}`));
    await waitFor(() =>
      expect(
        api.callsTo('POST', `/v1/events/${EVENT_ID}/join-requests/${ids.other}/approve`),
      ).toHaveLength(1),
    );
  });

  it('checks in by location when the window is open', async () => {
    jest
      .mocked(Location.requestForegroundPermissionsAsync)
      .mockResolvedValueOnce({ granted: true } as never);
    api
      .on('GET', `/v1/events/${EVENT_ID}`, {
        status: 200,
        body: eventFixture({}, { rsvp: 'going', canRsvp: false, canCheckIn: true }),
      })
      .on('POST', `/v1/events/${EVENT_ID}/check-in`, {
        status: 200,
        body: {
          userId: ids.me,
          displayName: 'Priya R.',
          checkedInAt: '2026-11-03T12:31:00.000Z',
          method: 'geofence',
        },
      });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('self-check-in'));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/check-in`)[0]?.body).toEqual({
        point: { lat: 17.4436, lng: 78.3519 },
      }),
    );
  });

  it('host tools: edit, cancel, scan; shares the link', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: eventFixture(
        { hosts: [{ person: me, role: 'host' }] },
        { isHost: true, hostRole: 'host', rsvp: 'going', canRsvp: false, blockedReason: 'HOST' },
      ),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('share'));
    expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining('http://web.test/e/AbCd2345') as string,
    });
    await fireEvent.press(screen.getByTestId('edit'));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/plot', params: { id: EVENT_ID } });
    await fireEvent.press(screen.getByTestId('scan'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/scan',
      params: { id: EVENT_ID },
    });
    expect(screen.queryByTestId('leave')).toBeNull();
    // Hosts scan guests in; they never get a check-in code (or self check-in) of their own.
    expect(screen.queryByTestId('open-ticket')).toBeNull();
    expect(screen.queryByTestId('self-check-in')).toBeNull();
  });

  it('cancels a plan with a reason', async () => {
    api.on('POST', `/v1/events/${EVENT_ID}/cancel`, {
      status: 200,
      body: eventFixture({ status: 'cancelled', cancelledReason: 'Rain' }),
    });
    await renderWithProviders(<CancelEventScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('cancel-reason'), 'Rain');
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/cancel`)[0]?.body).toEqual({
        reason: 'Rain',
      }),
    );
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });
});

describe('Plot flow (F-EVT-01/02)', () => {
  afterEach(() => {
    jest.useRealTimers();
  });
  beforeEach(() => {
    freezeToday();
    mockRouteParams.current = {};
    api
      .on('GET', '/v1/interests', { status: 200, body: { items: interestsFixture } })
      .on('GET', '/v1/venues/saved', { status: 200, body: { items: [] } })
      .on('GET', '/v1/venues/search', {
        status: 200,
        body: {
          venues: [],
          places: [
            { placeId: 'fx_lake', primaryText: 'Lake View Park', secondaryText: 'Gachibowli' },
          ],
        },
      })
      .on('POST', '/v1/venues/from-place', {
        status: 200,
        body: {
          id: '0192f3a4-5b6c-7d8e-9f01-00000000f00d',
          name: 'Lake View Park',
          address: 'Gachibowli',
          location: { lat: 17.44, lng: 78.35 },
          neighbourhoodName: 'Gachibowli',
          indoor: false,
          accessibility: { stepFree: false, accessibleRestroom: false, quietSpace: false },
          isPartner: false,
        },
      })
      .on('POST', '/v1/events', { status: 201, body: eventFixture() });
  });

  it('suggests at most five places while typing, then shows only the pick (D-157)', async () => {
    api.on('GET', '/v1/venues/search', {
      status: 200,
      body: {
        venues: [],
        places: Array.from({ length: 8 }, (_, i) => ({
          placeId: `fx_${String(i)}`,
          primaryText: `Lake ${String(i)}`,
          secondaryText: 'Gachibowli',
        })),
      },
    });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    expect(await screen.findByTestId('place-fx_4')).toBeOnTheScreen();
    expect(screen.queryByTestId('place-fx_5')).toBeNull();
    await fireEvent.press(screen.getByTestId('place-fx_0'));
    expect(await screen.findByTestId('plot-picked')).toBeOnTheScreen();
    expect(screen.queryByTestId('plot-suggestions')).toBeNull();
    expect(screen.queryByTestId('plot-place-search')).toBeNull();
    await fireEvent.press(screen.getByTestId('plot-change-place'));
    expect(screen.getByTestId('plot-place-search')).toBeOnTheScreen();
  });

  it('place search says when nothing matches and when search fails', async () => {
    let fail = false;
    api.on('GET', '/v1/venues/search', () =>
      fail
        ? { status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } }
        : { status: 200, body: { venues: [], places: [] } },
    );
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'zzz');
    expect(await screen.findByTestId('plot-place-empty')).toHaveTextContent(
      'No places match "zzz". Try another name, or drop a pin on the map.',
    );
    fail = true;
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'zzzz');
    expect(await screen.findByTestId('plot-place-error')).toBeOnTheScreen();
  });

  it('needs a place, then publishes with IST times and the chosen venue', async () => {
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee');
    await pickCategory(0);
    await pickWhen();
    await fireEvent.press(screen.getByTestId('plot-submit'));
    expect(await screen.findByText('Pick a place first')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    await fireEvent.press(await screen.findByTestId('place-fx_lake'));
    expect(await screen.findByTestId('plot-picked')).toHaveTextContent('Lake View Park');
    // Hosts can do without a group chat (D-156).
    await fireEvent(screen.getByTestId('plot-chat'), 'valueChange', false);
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() => expect(api.callsTo('POST', '/v1/events')).toHaveLength(1));
    const call = api.callsTo('POST', '/v1/events')[0];
    expect(call?.body).toMatchObject({
      title: 'Sunset frisbee',
      chatEnabled: false,
      categoryInterestId: interestsFixture[0]?.id,
      where: { venueId: '0192f3a4-5b6c-7d8e-9f01-00000000f00d' },
      startsAt: '2026-11-03T12:30:00.000Z',
      endsAt: '2026-11-03T14:30:00.000Z',
      capacity: 8,
      visibility: 'public',
    });
    expect(call?.headers['idempotency-key']).toMatch(/^plot-/);
    expect(mockRouter.replace).toHaveBeenCalledWith({
      pathname: '/events/[id]',
      params: { id: EVENT_ID },
    });
  });

  it('a failed squad invite still opens the new plan, once, with a notice', async () => {
    mockRouteParams.current = { inviteUserId: ids.other };
    api.on('POST', `/v1/events/${EVENT_ID}/invites`, {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee');
    await pickCategory(0);
    await pickWhen();
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    await fireEvent.press(await screen.findByTestId('place-fx_lake'));
    await screen.findByTestId('plot-picked');
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/events/[id]',
        params: { id: EVENT_ID, notice: 'inviteFailed' },
      }),
    );
    expect(api.callsTo('POST', '/v1/events')).toHaveLength(1);
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/invites`)).toHaveLength(1);
  });

  it('a retried submit reuses the same idempotency key, so it cannot create a second plan', async () => {
    api.on('POST', '/v1/events', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee');
    await pickCategory(0);
    await pickWhen();
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    await fireEvent.press(await screen.findByTestId('place-fx_lake'));
    await screen.findByTestId('plot-picked');
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() => expect(api.callsTo('POST', '/v1/events')).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId('plot-submit')).toBeEnabled());
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() => expect(api.callsTo('POST', '/v1/events')).toHaveLength(2));
    const [first, second] = api.callsTo('POST', '/v1/events');
    expect(second?.headers['idempotency-key']).toBe(first?.headers['idempotency-key']);
  });

  it('shows server errors in plain words', async () => {
    api.on('POST', '/v1/events', {
      status: 403,
      body: { error: { code: 'VERIFICATION_REQUIRED', message: 'x' } },
    });
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Chai');
    await pickCategory(0);
    await fireEvent.changeText(screen.getByTestId('plot-place-search'), 'lake');
    await fireEvent.press(await screen.findByTestId('place-fx_lake'));
    await fireEvent.press(screen.getByTestId('plot-submit'));
    expect(await screen.findByTestId('plot-error')).toBeOnTheScreen();
  });
});

describe('Plot flow: pin, advanced options and edits', () => {
  afterEach(() => {
    jest.useRealTimers();
  });
  beforeEach(() => {
    freezeToday();
    api
      .on('GET', '/v1/interests', { status: 200, body: { items: interestsFixture } })
      .on('GET', '/v1/venues/saved', { status: 200, body: { items: [] } })
      .on('GET', '/v1/vibe-tags', { status: 200, body: { items: vibesFixture } })
      .on('POST', '/v1/events', { status: 201, body: eventFixture() })
      .on('PATCH', `/v1/events/${EVENT_ID}`, { status: 200, body: eventFixture() });
  });

  it('drops a pin on the map, picks a quick time and sets advanced options', async () => {
    mockRouteParams.current = {};
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Mystery chai');
    await pickCategory(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Pick on map' }));
    await fireEvent(screen.getByTestId('plot-map'), 'press', {
      nativeEvent: { coordinate: { latitude: 17.44, longitude: 78.35 } },
    });
    await fireEvent.changeText(screen.getByTestId('plot-pin-address'), 'Near the big banyan tree');
    await fireEvent.press(screen.getByRole('button', { name: 'Use this spot' }));
    expect(screen.getByTestId('plot-picked')).toHaveTextContent('Near the big banyan tree');
    await fireEvent.press(screen.getByRole('radio', { name: 'Tomorrow' }));
    await fireEvent.press(screen.getByTestId(`plot-visibility-balanced`));
    await fireEvent.press(screen.getByRole('radio', { name: 'Max share of any one gender: 70%' }));
    await fireEvent.press(screen.getByRole('button', { name: 'More options' }));
    await fireEvent.press(await screen.findByTestId(`plot-vibe-${vibesFixture[0]?.id ?? ''}`));
    await fireEvent(screen.getByTestId('plot-mystery'), 'valueChange', true);
    await fireEvent.press(screen.getByRole('radio', { name: 'Reveal the spot 4 h before' }));
    await fireEvent(screen.getByRole('switch', { name: 'Allow +1s' }), 'valueChange', true);
    await fireEvent(screen.getByRole('switch', { name: 'Step-free access' }), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('plot-submit'));
    await waitFor(() => expect(api.callsTo('POST', '/v1/events')).toHaveLength(1));
    expect(api.callsTo('POST', '/v1/events')[0]?.body).toMatchObject({
      where: {
        point: { lat: 17.44, lng: 78.35 },
        address: 'Near the big banyan tree',
        placeName: null,
      },
      visibility: 'balanced',
      balancedMaxSharePct: 70,
      mystery: true,
      mysteryRevealMinutesBefore: 240,
      allowPlusOnes: true,
      vibeTagIds: [vibesFixture[0]?.id],
      accessibility: { stepFree: true, accessibleRestroom: false, quietSpace: false },
    });
  });

  it('flags invalid input before calling the API', async () => {
    mockRouteParams.current = {};
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Pick on map' }));
    await fireEvent(screen.getByTestId('plot-map'), 'press', {
      nativeEvent: { coordinate: { latitude: 17.44, longitude: 78.35 } },
    });
    await fireEvent.changeText(screen.getByTestId('plot-pin-address'), 'Somewhere');
    await fireEvent.press(screen.getByRole('button', { name: 'Use this spot' }));
    await fireEvent.changeText(screen.getByTestId('plot-capacity'), '1');
    await fireEvent.press(screen.getByTestId('plot-submit'));
    expect(await screen.findAllByText(/./)).not.toHaveLength(0);
    expect(api.callsTo('POST', '/v1/events')).toHaveLength(0);
  });

  it('edits an existing plan and only sends the place when it changed', async () => {
    mockRouteParams.current = { id: EVENT_ID };
    await renderWithProviders(<PlotScreen />, { fetchFn: api.fetch });
    expect(await screen.findByDisplayValue('Sunset frisbee')).toBeOnTheScreen();
    expect(screen.getByTestId('plot-date')).toHaveAccessibleName('Date: Tue, 3 Nov, 2026');
    expect(screen.getByTestId('plot-time')).toHaveAccessibleName('Time: 6:00 pm');
    await fireEvent.changeText(screen.getByTestId('plot-title'), 'Sunset frisbee v2');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.callsTo('PATCH', `/v1/events/${EVENT_ID}`)).toHaveLength(1));
    const body = api.callsTo('PATCH', `/v1/events/${EVENT_ID}`)[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      title: 'Sunset frisbee v2',
      startsAt: '2026-11-03T12:30:00.000Z',
    });
    expect(body).not.toHaveProperty('where');
    expect(body).not.toHaveProperty('mysteryRevealMinutesBefore');
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('Tickets, scanning, invites, +1s', () => {
  it('renders the ticket QR', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}/ticket`, {
      status: 200,
      body: {
        qr: `tg1.${EVENT_ID}.${ids.me}.${'a'.repeat(32)}`,
        eventId: EVENT_ID,
        validFrom: '2026-11-03T12:00:00.000Z',
        validUntil: '2026-11-03T14:30:00.000Z',
      },
    });
    await renderWithProviders(<TicketScreen />, { fetchFn: api.fetch });
    expect(await screen.findByLabelText('Your check-in code')).toBeOnTheScreen();
    expect(screen.getByText(/^Valid /)).toBeOnTheScreen();
  });

  it('hosts check people in with a typed code when the camera is unavailable', async () => {
    api.on('POST', `/v1/events/${EVENT_ID}/check-in`, {
      status: 200,
      body: {
        userId: ids.other,
        displayName: 'Rohan K.',
        checkedInAt: '2026-11-03T12:31:00.000Z',
        method: 'qr',
      },
    });
    await renderWithProviders(<ScanScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByTestId('allow-camera'));
    await fireEvent.changeText(
      screen.getByTestId('manual-code'),
      `tg1.${EVENT_ID}.${ids.other}.${'b'.repeat(32)}`,
    );
    await fireEvent.press(screen.getByTestId('manual-check-in'));
    expect(await screen.findByTestId('scan-result')).toHaveTextContent('Rohan K. checked in');
  });

  it('invites squad members', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}/invitees`, {
        status: 200,
        body: { items: [{ person: host, invited: false, rsvp: null }] },
      })
      .on('POST', `/v1/events/${EVENT_ID}/invites`, { status: 200, body: { invited: 1 } });
    await renderWithProviders(<InviteScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId(`invitee-${ids.other}`));
    await fireEvent.press(screen.getByTestId('send-invites'));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/invites`)[0]?.body).toEqual({
        userIds: [ids.other],
      }),
    );
    expect(await screen.findByText('1 invited')).toBeOnTheScreen();
  });

  it('brings a guest +1 and shares the claim link', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    api
      .on('GET', /^\/v1\/social\/squad$/, {
        status: 200,
        body: { items: [host], nextCursor: null },
      })
      .on('PUT', `/v1/events/${EVENT_ID}/rsvp`, {
        status: 200,
        body: {
          status: 'going',
          plusOneClaimUrl: 'http://web.test/claim/abcdefghijklmnopqrstuv',
          event: eventFixture(),
        },
      });
    await renderWithProviders(<PlusOneScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('plus-one-guest'));
    await waitFor(() =>
      expect(api.callsTo('PUT', `/v1/events/${EVENT_ID}/rsvp`)[0]?.body).toEqual({
        status: 'going',
        plusOne: { guest: true },
      }),
    );
    expect(share).toHaveBeenCalled();
    expect(await screen.findByTestId('plus-one-done')).toHaveTextContent(
      /claim\/abcdefghijklmnopqrstuv/,
    );
  });

  it("who's going: hosts see first-timers and can add a co-host", async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}`, {
        status: 200,
        body: eventFixture(
          { hosts: [{ person: me, role: 'host' }] },
          { isHost: true, hostRole: 'host', canRsvp: false },
        ),
      })
      .on('GET', `/v1/events/${EVENT_ID}/attendees`, {
        status: 200,
        body: {
          items: [
            {
              person: host,
              status: 'going',
              firstTime: true,
              plusOneOf: null,
              isHost: false,
              reliabilityTier: 'reliable',
            },
          ],
          hiddenCount: 2,
        },
      })
      .on('POST', `/v1/events/${EVENT_ID}/hosts`, { status: 200, body: eventFixture() });
    await renderWithProviders(<AttendeesScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('+2 keeping it low-key')).toBeOnTheScreen();
    // Hosts see each attendee's reliability tier (F-SAF-02).
    expect(screen.getByText(/Reliable/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: /First-timers to welcome/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Add co-host' }));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/hosts`)[0]?.body).toEqual({
        userId: ids.other,
        role: 'co_host',
      }),
    );
  });
});

describe('Deep links (F-EVT-17, F-EVT-07)', () => {
  it('opens a shared plan with its invite token', async () => {
    mockRouteParams.current = { slug: 'AbCd2345', i: 'tok123456789012345' };
    api.on('GET', '/v1/events/by-slug/AbCd2345', { status: 200, body: eventFixture() });
    await renderWithProviders(<SharedEventRoute />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('event-detail')).toBeOnTheScreen();
    expect(api.calls.find((c) => c.path === '/v1/events/by-slug/AbCd2345')).toBeDefined();
  });

  it('a signed-in member claims a +1 link', async () => {
    mockRouteParams.current = { token: 'abcdefghijklmnopqrstuv' };
    api.on('POST', '/v1/plus-ones/claim', {
      status: 200,
      body: { eventId: EVENT_ID, slug: 'AbCd2345' },
    });
    await renderWithProviders(<ClaimRoute />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByTestId('claim-plus-one'));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/events/[id]',
        params: { id: EVENT_ID },
      }),
    );
  });

  it('a signed-out visitor keeps the shared plan (and its invite) through sign-up', async () => {
    await useAuthStore.getState().signOut();
    mockRouteParams.current = { slug: 'AbCd2345', i: 'tok123456789012345' };
    await renderWithProviders(<SharedEventRoute />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Get started' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/');
    expect(useAuthFlowStore.getState().pendingLink).toBe('/e/AbCd2345?i=tok123456789012345');
  });

  it('a signed-out friend carries the claim token into sign-up', async () => {
    await useAuthStore.getState().signOut();
    mockRouteParams.current = { token: 'abcdefghijklmnopqrstuv' };
    await renderWithProviders(<ClaimRoute />, { fetchFn: api.fetch });
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/phone'));
    expect(useAuthFlowStore.getState().claimToken).toBe('abcdefghijklmnopqrstuv');
  });
});
