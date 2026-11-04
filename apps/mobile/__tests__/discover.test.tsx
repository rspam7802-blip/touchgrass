import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { FeedItem } from '@touchgrass/shared';
import * as Location from 'expo-location';
import DiscoverScreen from '../app/(app)/(tabs)/discover';
import SearchScreen from '../app/(app)/search';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  feedParams,
  regionToBox,
} from '../src/features/discovery/filters';
import { useAuthStore } from '../src/stores/auth-store';
import {
  authResponseFixture,
  FakeApi,
  ids,
  interestsFixture,
  vibesFixture,
} from '../test/fake-api';
import { mockRouter, renderWithProviders, resetStores } from '../test-utils';

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  photo: null,
  verified: false,
  mutualFriendCount: 1,
});
const pal = person(ids.other, 'Rohan K.');
const mutual = person('0192f3a4-5b6c-7d8e-9f01-00000000aaaa', 'Sneha P.');
const REQUEST_ID = '0192f3a4-5b6c-7d8e-9f01-0000000feed1';

function item(n: number, overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: `0192f3a4-5b6c-7d8e-9f01-00000000e${String(n).padStart(3, '0')}`,
    slug: `Slug${String(n).padStart(4, '0')}`,
    type: 'plan',
    status: 'published',
    title: `Plan ${String(n)}`,
    cover: null,
    startsAt: '2026-11-03T12:30:00.000Z',
    endsAt: '2026-11-03T14:30:00.000Z',
    timezone: 'Asia/Kolkata',
    location: {
      kind: 'exact',
      point: { lat: 17.44, lng: 78.35 },
      address: 'Lake Road',
      placeName: 'Lake View Park',
      neighbourhoodName: 'Gachibowli',
    },
    visibility: 'public',
    capacity: 10,
    goingCount: 5,
    spotsLeft: 5,
    waitlistCount: 0,
    pricePaise: 0,
    soloFriendly: true,
    smallGroup: false,
    mystery: false,
    indoor: true,
    accessibility: { stepFree: false, accessibleRestroom: false, quietSpace: false },
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
    },
    preview: { people: [pal], total: 5 },
    via: null,
    reasons: ['squad_going', 'interests'],
    distanceMeters: 1200,
    weather: { condition: 'rain', tempC: 26, precipitationProbability: 0.9, advice: 'indoor' },
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
  api = new FakeApi()
    .on('GET', '/v1/interests', { status: 200, body: { items: interestsFixture } })
    .on('GET', '/v1/vibe-tags', { status: 200, body: { items: vibesFixture } })
    .on('GET', '/v1/discover/feed', (c) => ({
      status: 200,
      body: {
        items: c.path
          ? [
              item(1),
              item(2, {
                via: mutual,
                preview: { people: [], total: 0 },
                reasons: ['friends_of_friends'],
                weather: null,
              }),
            ]
          : [],
        nextCursor: null,
        requestId: REQUEST_ID,
        center: { lat: 17.44, lng: 78.35 },
        weather: { condition: 'clear', tempC: 28.4, precipitationProbability: 0 },
      },
    }))
    .on('POST', '/v1/discover/clicks', { status: 204 });
});

describe('filter helpers', () => {
  it('serialises filters and counts the active ones', () => {
    const f = {
      ...DEFAULT_FILTERS,
      when: 'tonight' as const,
      free: true,
      vibeTagIds: ['a', 'b'],
      radiusKm: 5,
    };
    const p = feedParams(f, { lat: 17.443612, lng: 78.351911 });
    expect(Object.fromEntries(p)).toEqual({
      when: 'tonight',
      vibeTagIds: 'a,b',
      free: 'true',
      sort: 'recommended',
      radiusKm: '5',
      lat: '17.44361',
      lng: '78.35191',
    });
    expect(activeFilterCount(f)).toBe(4);
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
  });
  it('turns a map region into a capped bounding box and zoom', () => {
    expect(
      regionToBox({ latitude: 17.44, longitude: 78.35, latitudeDelta: 0.1, longitudeDelta: 0.1 }),
    ).toEqual({
      bbox: '78.3000,17.3900,78.4000,17.4900',
      zoom: 12,
    });
    expect(
      regionToBox({ latitude: 17, longitude: 78, latitudeDelta: 30, longitudeDelta: 30 }).bbox,
    ).toBe('77.0000,16.0000,79.0000,18.0000');
  });
});

describe('Discover tab (F-DSC-01..08)', () => {
  it('shows ranked plans with who is going, why, distance, via and weather; logs clicks', async () => {
    await renderWithProviders(<DiscoverScreen />, { fetchFn: api.fetch });
    const card = await screen.findByTestId('event-Slug0001');
    expect(card.props.accessibilityLabel).toEqual(expect.stringContaining('Rohan K. +4 more'));
    expect(card.props.accessibilityLabel).toEqual(
      expect.stringContaining('Squad going · Your interests'),
    );
    expect(card.props.accessibilityLabel).toEqual(expect.stringContaining('1.2 km away'));
    expect(card.props.accessibilityLabel).toEqual(expect.stringContaining('it is indoors'));
    expect(screen.getByTestId('event-Slug0002').props.accessibilityLabel).toEqual(
      expect.stringContaining('via Sneha P.'),
    );
    expect(screen.getByTestId('weather-chip')).toHaveTextContent('28° · Clear');
    await fireEvent.press(card);
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]',
      params: { id: item(1).id },
    });
    await waitFor(() =>
      expect(api.callsTo('POST', '/v1/discover/clicks')[0]?.body).toEqual({
        requestId: REQUEST_ID,
        eventId: item(1).id,
        position: 0,
      }),
    );
  });

  it('labels curated and featured plans and shows times in the plan’s city zone (F-GRW-03)', async () => {
    api.on('GET', '/v1/discover/feed', {
      status: 200,
      body: {
        items: [
          item(3, {
            type: 'curated',
            reasons: ['featured', 'interests'],
            startsAt: '2026-11-03T12:30:00.000Z',
            timezone: 'Asia/Dubai',
          }),
        ],
        nextCursor: null,
        requestId: REQUEST_ID,
        center: { lat: 17.44, lng: 78.35 },
        weather: null,
      },
    });
    await renderWithProviders(<DiscoverScreen />, { fetchFn: api.fetch });
    const card = await screen.findByTestId('event-Slug0003');
    const label = card.props.accessibilityLabel as string;
    expect(label).toContain('Picked by the TouchGrass team');
    expect(label).toContain('Featured in your city · Your interests');
    // 12:30 UTC is 4:30 pm in Dubai (it would be 6:00 pm in IST).
    expect(label).toMatch(/4:30\s?pm/i);
  });

  it('browses like an events app: featured carousel, themed rails, then all plans (D-155)', async () => {
    const items = [
      item(1, { reasons: ['interests'], soloFriendly: true }),
      item(2, { reasons: ['squad_going'], soloFriendly: true }),
      item(3, { reasons: ['featured'] }),
      item(4, { reasons: ['squad_going'] }),
      item(5, { reasons: ['nearby'] }),
    ];
    api.on('GET', '/v1/discover/feed', {
      status: 200,
      body: {
        items,
        nextCursor: null,
        requestId: REQUEST_ID,
        center: { lat: 17.44, lng: 78.35 },
        weather: null,
      },
    });
    await renderWithProviders(<DiscoverScreen />, { fetchFn: api.fetch });
    await screen.findByTestId('hero-carousel');
    // Featured first, then the ranked order.
    const heroIds = screen
      .getAllByTestId(/^hero-Slug/)
      .map((n) => String(n.props.testID).replace('hero-', ''));
    expect(heroIds).toEqual(['Slug0003', 'Slug0001', 'Slug0002', 'Slug0004', 'Slug0005']);
    expect(screen.getByRole('header', { name: 'Your squad is going' })).toBeOnTheScreen();
    expect(screen.getByTestId('tile-squad-Slug0004')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Good to go solo' })).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'All plans' })).toBeOnTheScreen();
    expect(screen.getByTestId('event-Slug0005')).toBeOnTheScreen();
    // Opening from a rail logs the plan's real feed position.
    await fireEvent.press(screen.getByTestId('tile-squad-Slug0004'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]',
      params: { id: item(4).id },
    });
    await waitFor(() =>
      expect(api.callsTo('POST', '/v1/discover/clicks')[0]?.body).toMatchObject({ position: 3 }),
    );
    // A filter narrows to the plain list.
    await fireEvent.press(screen.getByTestId('toggle-soloFriendly'));
    await waitFor(() => expect(screen.queryByTestId('hero-carousel')).toBeNull());
  });

  it('quick chips and the filter panel change the query; clear resets it', async () => {
    const urls: string[] = [];
    api.on('GET', '/v1/discover/feed', (c) => {
      urls.push(c.url);
      return {
        status: 200,
        body: {
          items: [],
          nextCursor: null,
          requestId: REQUEST_ID,
          center: { lat: 17.44, lng: 78.35 },
          weather: null,
        },
      };
    });
    await renderWithProviders(<DiscoverScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText(/Nothing matches yet/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('when-tonight'));
    await fireEvent.press(screen.getByTestId('toggle-free'));
    await fireEvent.press(screen.getByTestId('more-filters'));
    await fireEvent.press(screen.getByTestId('sort-nearest'));
    await fireEvent.press(screen.getByTestId('radius-25'));
    await fireEvent.press(screen.getByTestId('toggle-stepFree'));
    await fireEvent.press(await screen.findByTestId(`filter-vibe-${vibesFixture[0]?.id ?? ''}`));
    await waitFor(() => {
      const last = new URL(urls[urls.length - 1] ?? 'http://x').searchParams;
      expect(Object.fromEntries(last)).toMatchObject({
        when: 'tonight',
        free: 'true',
        stepFree: 'true',
        sort: 'nearest',
        radiusKm: '25',
        vibeTagIds: vibesFixture[0]?.id,
      });
    });
    expect(screen.getByTestId('more-filters')).toHaveTextContent('Filters (5)');
    await fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() =>
      expect(new URL(urls[urls.length - 1] ?? 'http://x').searchParams.get('when')).toBeNull(),
    );
  });

  it('asks for location and re-centres the feed', async () => {
    jest
      .mocked(Location.getForegroundPermissionsAsync)
      .mockResolvedValueOnce({ granted: false, canAskAgain: true } as never);
    jest
      .mocked(Location.requestForegroundPermissionsAsync)
      .mockResolvedValueOnce({ granted: true } as never);
    await renderWithProviders(<DiscoverScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('use-location'));
    await waitFor(() => {
      const urls = api.calls
        .filter((c) => c.path === '/v1/discover/feed')
        .map((c) => new URL(c.url).searchParams.get('lat'));
      expect(urls).toContain('17.44360');
    });
  });

  it('map view lists pins and clusters for everyone, including screen readers', async () => {
    api.on('GET', '/v1/discover/map', {
      status: 200,
      body: {
        pins: [
          {
            id: item(3).id,
            slug: 'Slug0003',
            title: 'Mystery chai',
            center: { lat: 17.45, lng: 78.36 },
            radiusMeters: 2000,
            mystery: true,
            startsAt: '2026-11-03T12:30:00.000Z',
            emoji: '☕',
          },
        ],
        clusters: [{ center: { lat: 17.41, lng: 78.43 }, count: 7 }],
        truncated: true,
      },
    });
    await renderWithProviders(<DiscoverScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Map' }));
    expect(await screen.findByTestId('pin-Slug0003')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: '7 plans here' })).toBeOnTheScreen();
    expect(screen.getByText('Zoom in to see every plan here.')).toBeOnTheScreen();
    const mapCall = api.calls.find((c) => c.path === '/v1/discover/map');
    expect(new URL(mapCall?.url ?? 'http://x').searchParams.get('bbox')).toMatch(
      /^[\d.]+,[\d.]+,[\d.]+,[\d.]+$/,
    );
    await fireEvent(screen.getByTestId('discover-mapview'), 'regionChangeComplete', {
      latitude: 17.4,
      longitude: 78.4,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    });
    await waitFor(() =>
      expect(api.calls.filter((c) => c.path === '/v1/discover/map').length).toBeGreaterThanOrEqual(
        2,
      ),
    );
    await fireEvent.press(screen.getByTestId('pin-Slug0003'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]',
      params: { id: item(3).id },
    });
  });

  it('error and empty states', async () => {
    api.on('GET', '/v1/discover/feed', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    });
    await renderWithProviders(<DiscoverScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('state-error')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('open-search'));
    expect(mockRouter.push).toHaveBeenCalledWith('/search');
  });
});

describe('Search (F-DSC-09)', () => {
  it('debounces, shows plans, people and places, and plots at a place', async () => {
    api.on('GET', '/v1/discover/search', {
      status: 200,
      body: {
        events: [item(4)],
        people: [pal],
        venues: [
          {
            id: '0192f3a4-5b6c-7d8e-9f01-00000000f00d',
            name: 'Lake View Park',
            address: 'Lake Road',
            location: { lat: 17.44, lng: 78.35 },
            neighbourhoodName: 'Gachibowli',
            indoor: false,
            accessibility: { stepFree: false, accessibleRestroom: false, quietSpace: false },
            isPartner: false,
          },
        ],
      },
    });
    await renderWithProviders(<SearchScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('search-input'), 'lake');
    expect(await screen.findByTestId('event-Slug0004')).toBeOnTheScreen();
    expect(api.calls.filter((c) => c.path === '/v1/discover/search')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Rohan K\./ })).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('venue-0192f3a4-5b6c-7d8e-9f01-00000000f00d'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/plot',
      params: { venueId: '0192f3a4-5b6c-7d8e-9f01-00000000f00d', venueName: 'Lake View Park' },
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'People' }));
    await waitFor(() =>
      expect(
        new URL(api.calls[api.calls.length - 1]?.url ?? 'http://x').searchParams.get('type'),
      ).toBe('people'),
    );
  });

  it('lists matching crews and opens one', async () => {
    const crewId = '0192f3a4-5b6c-7d8e-9f01-00000000c0de';
    api.on('GET', '/v1/discover/search', {
      status: 200,
      body: {
        events: [],
        people: [],
        venues: [],
        crews: [
          {
            id: crewId,
            name: 'Lakeside walkers',
            description: 'Sunrise loops.',
            cover: null,
            interestId: null,
            joinPolicy: 'request',
            memberCount: 12,
            nextSession: null,
            viewer: { role: null, status: null },
            held: false,
          },
        ],
      },
    });
    await renderWithProviders(<SearchScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('search-input'), 'lakeside');
    expect(await screen.findByRole('header', { name: 'Crews' })).toBeOnTheScreen();
    expect(screen.getByTestId(`crew-${crewId}`)).toHaveTextContent(/12 members/);
    await fireEvent.press(screen.getByTestId(`crew-${crewId}`));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/crews/[id]',
      params: { id: crewId },
    });
    await fireEvent.press(screen.getByRole('tab', { name: 'Crews' }));
    await waitFor(() =>
      expect(
        new URL(api.calls[api.calls.length - 1]?.url ?? 'http://x').searchParams.get('type'),
      ).toBe('crews'),
    );
  });

  it('says when nothing matches', async () => {
    api.on('GET', '/v1/discover/search', {
      status: 200,
      body: { events: [], people: [], venues: [] },
    });
    await renderWithProviders(<SearchScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('search-input'), 'zzz');
    expect(await screen.findByText('No results for "zzz".')).toBeOnTheScreen();
  });
});
