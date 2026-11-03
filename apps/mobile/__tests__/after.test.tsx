import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type {
  EventDetail,
  FeedbackSummary,
  LoreAlbum,
  LoreItem,
  PersonCard,
  PostEventCard,
} from '@touchgrass/shared';
import { AppState, type AppStateStatus } from 'react-native';
import * as Sharing from 'expo-sharing';
import AfterEventScreen from '../app/(app)/after/[id]';
import FeedbackSummaryScreen from '../app/(app)/events/[id]/feedback';
import EventScreen from '../app/(app)/events/[id]/index';
import LoreScreen from '../app/(app)/events/[id]/lore';
import { AfterEventPrompter, resetOfferedPostEvents } from '../src/features/after/prompter';
import { ApiError } from '../src/lib/api-client';
import { errorMessage } from '../src/lib/errors';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids, urlsFixture } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const EVENT_ID = '0192f3a4-5b6c-7d8e-9f01-00000000e001';
const PERSON_B = '0192f3a4-5b6c-7d8e-9f01-000000000003';
const PERSON_C = '0192f3a4-5b6c-7d8e-9f01-000000000004';
const PERSON_D = '0192f3a4-5b6c-7d8e-9f01-000000000005';
const LORE_1 = '0192f3a4-5b6c-7d8e-9f01-0000000d0001';
const LORE_2 = '0192f3a4-5b6c-7d8e-9f01-0000000d0002';

const person = (id: string, displayName: string): PersonCard => ({
  id,
  displayName,
  photo: null,
  verified: false,
  mutualFriendCount: 0,
});
const host = person(ids.other, 'Ravi K.');
const me = person(ids.me, 'Asha');

function card(over: Partial<PostEventCard> = {}): PostEventCard {
  return {
    event: {
      id: EVENT_ID,
      title: 'Sunset run at KBR',
      startsAt: '2026-10-30T12:30:00.000Z',
      endsAt: '2026-10-30T14:30:00.000Z',
      cover: null,
    },
    host,
    feedback: null,
    feedbackOpenUntil: new Date(Date.now() + 10 * 86_400_000).toISOString(),
    people: [
      { person: person(PERSON_B, 'Kiran'), state: 'none' },
      { person: person(PERSON_C, 'Meera'), state: 'pulled_you' },
      { person: person(PERSON_D, 'Sam'), state: 'squad' },
    ],
    loreCount: 0,
    canAddLore: true,
    badges: [],
    ...over,
  };
}

function loreItem(id: string, over: Partial<LoreItem> = {}): LoreItem {
  return {
    id,
    image: urlsFixture,
    caption: '',
    captionHeld: false,
    uploader: host,
    mine: false,
    createdAt: '2026-10-30T15:00:00.000Z',
    ...over,
  };
}

function album(over: Partial<LoreAlbum> = {}): LoreAlbum {
  return {
    eventId: EVENT_ID,
    eventTitle: 'Sunset run at KBR',
    visibility: 'attendees',
    cover: null,
    count: 0,
    canAdd: true,
    canManage: false,
    items: [],
    nextCursor: null,
    ...over,
  };
}

function completedEvent(
  viewer: Partial<EventDetail['viewer']> = {},
  over: Partial<EventDetail> = {},
): EventDetail {
  return {
    id: EVENT_ID,
    slug: 'AbCd2345',
    type: 'plan',
    status: 'completed',
    title: 'Sunset run at KBR',
    cover: null,
    startsAt: '2026-10-30T12:30:00.000Z',
    endsAt: '2026-10-30T14:30:00.000Z',
    timezone: 'Asia/Kolkata',
    location: {
      kind: 'exact',
      point: { lat: 17.42, lng: 78.42 },
      address: 'KBR Park gate 1',
      placeName: 'KBR Park',
      neighbourhoodName: 'Jubilee Hills',
    },
    visibility: 'public',
    capacity: 12,
    goingCount: 6,
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
      rsvp: 'checked_in',
      isHost: false,
      hostRole: null,
      invitedBy: null,
      offer: null,
      plusOne: null,
      waitlistPosition: null,
      canRsvp: false,
      blockedReason: null,
      canCheckIn: false,
      payment: null,
      cooldownUntil: null,
      ...viewer,
    },
    description: '',
    hosts: [{ person: host, role: 'host' }],
    interests: [],
    vibeTags: [],
    minGroupSize: 2,
    allowPlusOnes: false,
    balancedMaxSharePct: null,
    soloPercent: 50,
    cancelledReason: null,
    shareUrl: 'http://web.test/e/AbCd2345',
    refundPolicy: { kind: 'none', cutoffHours: 0, partialPct: null },
    perks: [],
    lore: { count: 3, canAdd: true },
    crew: null,
    held: false,
    ...over,
  };
}

let api: FakeApi;
beforeEach(async () => {
  resetStores();
  resetOfferedPostEvents();
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  mockRouter.back.mockClear();
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
  api = new FakeApi();
});

describe('How was it? (F-AFT-01/02)', () => {
  it('rates the plan and the host with tags and a private comment', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}/after`, { status: 200, body: card() })
      .on('PUT', `/v1/events/${EVENT_ID}/feedback`, (c) => ({
        status: 200,
        body: { ...(c.body as object), createdAt: '2026-11-01T10:00:00.000Z' },
      }));
    await renderWithProviders(<AfterEventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Sunset run at KBR')).toBeOnTheScreen();
    const send = screen.getByRole('button', { name: 'Send feedback' });
    expect(send).toBeDisabled();
    await fireEvent.press(screen.getByTestId('rate-event-4'));
    expect(screen.getByTestId('rate-event-4')).toBeChecked();
    expect(screen.getByText('Rate Ravi K. as host')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('rate-host-5'));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Great people' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Welcoming' }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Started late' }));
    await fireEvent.changeText(screen.getByTestId('feedback-comment'), '  Loved the pace  ');
    await fireEvent.press(send);
    expect(await screen.findByTestId('feedback-thanks')).toHaveTextContent(/Thanks!/);
    expect(api.callsTo('PUT', `/v1/events/${EVENT_ID}/feedback`)[0]?.body).toEqual({
      rating: 4,
      hostRating: 5,
      // Tags keep their canonical order whatever order they were tapped in.
      great: ['welcoming', 'great_people'],
      improve: ['started_late'],
      comment: '  Loved the pace  ',
    });
  });

  it('prefills earlier feedback; no host means no host rating', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}/after`, {
      status: 200,
      body: card({
        host: null,
        feedback: {
          rating: 3,
          hostRating: null,
          great: ['fun_activity'],
          improve: [],
          comment: 'ok',
          createdAt: '2026-10-31T10:00:00.000Z',
        },
      }),
    });
    await renderWithProviders(<AfterEventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('rate-event-3')).toBeChecked();
    expect(screen.queryByTestId('rate-host')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Fun activity' })).toBeChecked();
    expect(screen.getByTestId('feedback-comment')).toHaveDisplayValue('ok');
  });

  it('after the window closes the form is replaced by an explanation', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}/after`, {
      status: 200,
      body: card({ feedbackOpenUntil: new Date(Date.now() - 1000).toISOString() }),
    });
    await renderWithProviders(<AfterEventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('feedback-closed')).toHaveTextContent(
      'Feedback for this plan has closed.',
    );
    expect(screen.queryByRole('button', { name: 'Send feedback' })).toBeNull();
  });

  it('shows server errors from sending', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}/after`, { status: 200, body: card() })
      .on('PUT', `/v1/events/${EVENT_ID}/feedback`, {
        status: 422,
        body: {
          error: { code: 'NOT_ELIGIBLE', message: 'x', details: { reason: 'NOT_ATTENDED' } },
        },
      });
    await renderWithProviders(<AfterEventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('rate-event-5'));
    await fireEvent.press(screen.getByRole('button', { name: 'Send feedback' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only people who checked in can do this.',
    );
  });
});

describe('People you met (F-AFT-03)', () => {
  it('pulls someone; each relationship state reads correctly', async () => {
    let state: 'none' | 'pulled' = 'none';
    api
      .on('GET', `/v1/events/${EVENT_ID}/after`, () => ({
        status: 200,
        body: card({
          people: [
            { person: person(PERSON_B, 'Kiran'), state },
            { person: person(PERSON_C, 'Meera'), state: 'pulled_you' },
            { person: person(PERSON_D, 'Sam'), state: 'squad' },
            { person: me, state: 'request_sent' },
          ],
        }),
      }))
      .on('POST', `/v1/events/${EVENT_ID}/people/${PERSON_B}/pull`, () => {
        state = 'pulled';
        return { status: 200, body: { state: 'pulled' } };
      });
    await renderWithProviders(<AfterEventScreen />, { fetchFn: api.fetch });
    expect(
      await screen.findByRole('button', { name: 'Pulled you · tap to connect' }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId(`pull-state-${PERSON_D}`)).toHaveTextContent('Squad');
    expect(screen.getByTestId(`pull-state-${ids.me}`)).toHaveTextContent('Request sent');
    await fireEvent.press(screen.getByTestId(`pull-${PERSON_B}`));
    expect(await screen.findByTestId(`pull-state-${PERSON_B}`)).toHaveTextContent('Pulled');
  });

  it('nobody else checked in', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}/after`, { status: 200, body: card({ people: [] }) });
    await renderWithProviders(<AfterEventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Nobody else checked in this time.')).toBeOnTheScreen();
  });

  it('opens a person, the Lore, shows badges; Done wraps up, Later does not', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}/after`, {
        status: 200,
        body: card({
          loreCount: 4,
          badges: [{ key: 'first_plan', name: 'First plan', emoji: '🌱' }],
        }),
      })
      .on('POST', `/v1/events/${EVENT_ID}/after/dismiss`, { status: 204 });
    await renderWithProviders(<AfterEventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('after-badges')).toHaveTextContent(/First plan/);
    await fireEvent.press(screen.getByRole('button', { name: /^Kiran/ }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/users/[id]',
      params: { id: PERSON_B },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'See the Lore (4)' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/lore',
      params: { id: EVENT_ID },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Later' }));
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/after/dismiss`)).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(2));
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/after/dismiss`)).toHaveLength(1);
  });

  it('without history to go back to, Done lands on home', async () => {
    mockRouter.canGoBack.mockReturnValueOnce(false);
    api
      .on('GET', `/v1/events/${EVENT_ID}/after`, { status: 200, body: card() })
      .on('POST', `/v1/events/${EVENT_ID}/after/dismiss`, { status: 204 });
    await renderWithProviders(<AfterEventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Done' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/'));
  });

  it('shows an error state when the card cannot load', async () => {
    await renderWithProviders(<AfterEventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByRole('button', { name: /Try again/ })).toBeOnTheScreen();
  });
});

describe('Post-event prompt', () => {
  // React Native's Jest preset stubs AppState without subscriptions; capture the listener instead.
  let listener: ((s: AppStateStatus) => void) | null = null;
  let spy: jest.SpyInstance;
  beforeEach(() => {
    listener = null;
    spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
      listener = fn;
      return { remove: jest.fn() };
    });
  });
  afterEach(() => {
    spy.mockRestore();
  });

  it('opens the newest pending plan once per session, even across foregrounds', async () => {
    api.on('GET', '/v1/me/after', { status: 200, body: { card: card() } });
    await renderWithProviders(<AfterEventPrompter />, { fetchFn: api.fetch });
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith({
        pathname: '/after/[id]',
        params: { id: EVENT_ID },
      }),
    );
    await act(async () => {
      listener?.('background');
      listener?.('active');
      await Promise.resolve();
    });
    await waitFor(() => expect(api.callsTo('GET', '/v1/me/after')).toHaveLength(2));
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it('does nothing when there is nothing to wrap up', async () => {
    api.on('GET', '/v1/me/after', { status: 200, body: { card: null } });
    await renderWithProviders(<AfterEventPrompter />, { fetchFn: api.fetch });
    await waitFor(() => expect(api.callsTo('GET', '/v1/me/after')).toHaveLength(1));
    expect(mockRouter.push).not.toHaveBeenCalled();
  });
});

describe('Lore (F-AFT-04)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const routeUploads = (status: 'ready' | 'processing', after: 'ready' | 'flagged' = 'ready') => {
    api
      .on('POST', '/v1/media/uploads', {
        status: 201,
        body: {
          assetId: ids.asset,
          upload: {
            url: 'https://s3.test/bucket',
            fields: { key: 'uploads/k' },
            expiresAt: '2026-11-01T01:00:00.000Z',
          },
        },
      })
      .on('POST', '/bucket', { status: 204 })
      .on('POST', `/v1/media/${ids.asset}/complete`, {
        status: 200,
        body: { id: ids.asset, purpose: 'lore', status, width: null, height: null, urls: null },
      })
      .on('GET', `/v1/media/${ids.asset}`, {
        status: 200,
        body: {
          id: ids.asset,
          purpose: 'lore',
          status: after,
          width: 800,
          height: 1000,
          urls: after === 'ready' ? urlsFixture : null,
        },
      });
    global.fetch = (input: string | URL | Request, init?: RequestInit) =>
      (typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      ).startsWith('file:')
        ? Promise.resolve(new Response('x'.repeat(4096)))
        : api.fetch(input, init);
  };

  it('empty album: adds a photo with a caption once it is checked', async () => {
    let items: LoreItem[] = [];
    routeUploads('processing');
    api
      .on('GET', `/v1/events/${EVENT_ID}/lore`, () => ({
        status: 200,
        body: album({ items, count: items.length }),
      }))
      .on('POST', `/v1/events/${EVENT_ID}/lore`, () => {
        items = [loreItem(LORE_1, { caption: 'Finish line', mine: true, uploader: me })];
        return { status: 201, body: { id: LORE_1 } };
      });
    await renderWithProviders(<LoreScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('No photos yet. Be the first to add one.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('lore-caption'), 'Finish line');
    await fireEvent.press(screen.getByRole('button', { name: 'Add photos' }));
    expect(
      await screen.findByRole(
        'imagebutton',
        { name: 'Finish line, Photo by Asha' },
        { timeout: 4000 },
      ),
    ).toBeOnTheScreen();
    expect(api.callsTo('POST', '/v1/media/uploads')[0]?.body).toMatchObject({ purpose: 'lore' });
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/lore`)[0]?.body).toEqual({
      mediaId: ids.asset,
      caption: 'Finish line',
    });
    expect(screen.getByTestId('lore-caption')).toHaveDisplayValue('');
  });

  it('a photo held for review is not added yet and says so', async () => {
    routeUploads('processing', 'flagged');
    api.on('GET', `/v1/events/${EVENT_ID}/lore`, { status: 200, body: album() });
    await renderWithProviders(<LoreScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Add photos' }));
    expect(await screen.findByTestId('lore-notice', {}, { timeout: 4000 })).toHaveTextContent(
      'Your photo will appear once it has been checked.',
    );
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/lore`)).toHaveLength(0);
  });

  it('the per-person limit is explained', async () => {
    routeUploads('ready');
    api
      .on('GET', `/v1/events/${EVENT_ID}/lore`, { status: 200, body: album() })
      .on('POST', `/v1/events/${EVENT_ID}/lore`, {
        status: 422,
        body: { error: { code: 'NOT_ELIGIBLE', message: 'x', details: { reason: 'LORE_LIMIT' } } },
      });
    await renderWithProviders(<LoreScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Add photos' }));
    expect(await screen.findByTestId('lore-error')).toHaveTextContent(
      "You've added the most photos allowed for this plan.",
    );
  });

  it('opens a photo to save or report it; pages load more', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}/lore`, (c) => ({
        status: 200,
        body: c.url.includes('cursor=')
          ? album({ count: 2, canAdd: false, items: [loreItem(LORE_2)] })
          : album({
              count: 2,
              canAdd: false,
              items: [loreItem(LORE_1, { caption: 'Golden hour' })],
              nextCursor: 'c1',
            }),
      }))
      .on('GET', `/v1/events/${EVENT_ID}/lore/download`, {
        status: 200,
        body: {
          items: [
            { id: LORE_1, url: 'https://s3.test/lore/1.webp' },
            { id: LORE_2, url: 'https://s3.test/lore/2.webp' },
          ],
          expiresAt: '2026-11-02T00:00:00.000Z',
        },
      });
    await renderWithProviders(<LoreScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId(`lore-item-${LORE_1}`)).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Add photos' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'More photos' }));
    expect(await screen.findByTestId(`lore-item-${LORE_2}`)).toBeOnTheScreen();

    await fireEvent.press(screen.getByRole('button', { name: 'Save photos' }));
    expect(await screen.findByTestId('lore-notice')).toHaveTextContent('Saved 2 photos');
    expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/lore-' + LORE_2 + '.webp', {
      mimeType: 'image/webp',
    });

    await fireEvent.press(screen.getByTestId(`lore-item-${LORE_1}`));
    expect(screen.getByTestId('lore-photo')).toHaveTextContent(/Golden hour/);
    expect(screen.queryByTestId('lore-remove')).toBeNull();
    await fireEvent.press(screen.getByTestId('lore-save-one'));
    await waitFor(() =>
      expect(Sharing.shareAsync).toHaveBeenLastCalledWith(`file:///cache/lore-${LORE_1}.webp`, {
        mimeType: 'image/webp',
      }),
    );
    await fireEvent.press(screen.getByTestId('lore-report'));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/report',
      params: { targetType: 'lore_media', targetId: LORE_1, name: 'Ravi K.' },
    });
  });

  it('without a share sheet nothing is saved', async () => {
    jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    api
      .on('GET', `/v1/events/${EVENT_ID}/lore`, {
        status: 200,
        body: album({ count: 1, items: [loreItem(LORE_1)] }),
      })
      .on('GET', `/v1/events/${EVENT_ID}/lore/download`, {
        status: 200,
        body: {
          items: [{ id: LORE_1, url: 'https://s3.test/1.webp' }],
          expiresAt: '2026-11-02T00:00:00.000Z',
        },
      });
    await renderWithProviders(<LoreScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Save photos' }));
    expect(await screen.findByTestId('lore-notice')).toHaveTextContent('Saved 0 photos');
  });

  it('hosts choose visibility and can remove any photo', async () => {
    let visibility: LoreAlbum['visibility'] = 'attendees';
    let items = [loreItem(LORE_1)];
    api
      .on('GET', `/v1/events/${EVENT_ID}/lore`, () => ({
        status: 200,
        body: album({ canManage: true, visibility, items, count: items.length }),
      }))
      .on('PUT', `/v1/events/${EVENT_ID}/lore/visibility`, (c) => {
        visibility = (c.body as { visibility: LoreAlbum['visibility'] }).visibility;
        return { status: 204 };
      })
      .on('DELETE', `/v1/lore/${LORE_1}`, () => {
        items = [];
        return { status: 204 };
      });
    await renderWithProviders(<LoreScreen />, { fetchFn: api.fetch });
    const squads = await screen.findByRole('radio', { name: 'Their squads too' });
    expect(screen.getByRole('radio', { name: 'People who were there' })).toBeChecked();
    await fireEvent.press(squads);
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Their squads too' })).toBeChecked(),
    );
    expect(api.callsTo('PUT', `/v1/events/${EVENT_ID}/lore/visibility`)[0]?.body).toEqual({
      visibility: 'friends_of_attendees',
    });
    await fireEvent.press(screen.getByTestId(`lore-item-${LORE_1}`));
    await fireEvent.press(screen.getByTestId('lore-remove'));
    expect(await screen.findByText('No photos yet. Be the first to add one.')).toBeOnTheScreen();
  });

  it('shows an error state when the album is not visible', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}/lore`, {
      status: 403,
      body: { error: { code: 'FORBIDDEN', message: 'x' } },
    });
    await renderWithProviders(<LoreScreen />, { fetchFn: api.fetch });
    expect(await screen.findByRole('button', { name: /Try again/ })).toBeOnTheScreen();
  });
});

describe('Host feedback summary (F-HST-02)', () => {
  const summary = (over: Partial<FeedbackSummary> = {}): FeedbackSummary => ({
    eventId: EVENT_ID,
    count: 4,
    averageRating: 4.25,
    hostAverage: 4.5,
    hostCount: 4,
    great: [{ tag: 'great_people', count: 3 }],
    improve: [{ tag: 'too_loud', count: 1 }],
    comments: [{ comment: 'More water please', rating: 4, createdAt: '2026-10-31T10:00:00.000Z' }],
    ...over,
  });

  it('shows averages, tags and anonymous comments', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}/feedback/summary`, { status: 200, body: summary() });
    await renderWithProviders(<FeedbackSummaryScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('feedback-count')).toHaveTextContent('4 responses');
    expect(screen.getByTestId('feedback-average')).toHaveTextContent('Average 4.3/5');
    expect(screen.getByTestId('feedback-host-average')).toHaveTextContent('As host 4.5/5');
    expect(screen.getByTestId('great-tags')).toHaveTextContent(/Great people · 3/);
    expect(screen.getByTestId('improve-tags')).toHaveTextContent(/Too loud · 1/);
    expect(screen.getByTestId('feedback-comments')).toHaveTextContent(/More water please/);
  });

  it('few responses: no comments, no tags; none at all: empty state', async () => {
    let s = summary({ count: 2, comments: [], great: [], improve: [], hostAverage: null });
    api.on('GET', `/v1/events/${EVENT_ID}/feedback/summary`, () => ({ status: 200, body: s }));
    const r = await renderWithProviders(<FeedbackSummaryScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('feedback-count')).toHaveTextContent('2 responses');
    expect(screen.queryByTestId('feedback-comments')).toBeNull();
    expect(screen.queryByTestId('great-tags')).toBeNull();
    expect(screen.queryByTestId('feedback-host-average')).toBeNull();
    s = summary({
      count: 0,
      averageRating: null,
      hostAverage: null,
      comments: [],
      great: [],
      improve: [],
    });
    await act(async () => {
      await r.queryClient.invalidateQueries();
    });
    expect(await screen.findByText('No feedback yet.')).toBeOnTheScreen();
  });

  it('error state', async () => {
    await renderWithProviders(<FeedbackSummaryScreen />, { fetchFn: api.fetch });
    expect(await screen.findByRole('button', { name: /Try again/ })).toBeOnTheScreen();
  });
});

describe('After the plan, on the plan page', () => {
  it('attendees see the Lore and How was it?', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: completedEvent() });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'See the Lore (3)' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/lore',
      params: { id: EVENT_ID },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'How was it?' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/after/[id]',
      params: { id: EVENT_ID },
    });
    expect(screen.queryByTestId('open-feedback')).toBeNull();
  });

  it('hosts see feedback; an empty album reads "Lore"', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: completedEvent(
        { isHost: true, hostRole: 'host', rsvp: null },
        { lore: { count: 0, canAdd: true } },
      ),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByRole('button', { name: 'Lore' })).toBeOnTheScreen();
    expect(screen.queryByTestId('open-after')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Feedback' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/events/[id]/feedback',
      params: { id: EVENT_ID },
    });
  });

  it('a reliability cooldown says when popular plans open again (F-SAF-02)', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}`, {
      status: 200,
      body: completedEvent(
        {
          rsvp: null,
          canRsvp: false,
          blockedReason: 'RELIABILITY_COOLDOWN',
          cooldownUntil: '2026-11-14T06:00:00.000Z',
        },
        { status: 'published', lore: null },
      ),
    });
    await renderWithProviders(<EventScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('blocked-reason')).toHaveTextContent(
      'After two recent no-shows, popular plans open to you again on 14 Nov.',
    );
    expect(screen.queryByTestId('open-lore')).toBeNull();
  });
});

describe('errorMessage', () => {
  const t = ((k: string, o?: { until?: Date; defaultValue?: string }) =>
    `${k}|${o?.until?.toISOString() ?? ''}|${o?.defaultValue ?? ''}`) as never;
  it('passes a cooldown end date through and ignores malformed ones', () => {
    const until = '2026-11-14T06:00:00.000Z';
    expect(
      errorMessage(
        t,
        new ApiError('NOT_ELIGIBLE', 'x', 422, { reason: 'RELIABILITY_COOLDOWN', until }),
      ),
    ).toBe(`events.reasons.RELIABILITY_COOLDOWN|${until}|errors.NOT_ELIGIBLE||`);
    expect(
      errorMessage(
        t,
        new ApiError('NOT_ELIGIBLE', 'x', 422, { reason: 'RELIABILITY_COOLDOWN', until: 'soon' }),
      ),
    ).toBe('events.reasons.RELIABILITY_COOLDOWN||errors.NOT_ELIGIBLE||');
  });
});
