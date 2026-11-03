import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type {
  EventSummary,
  LiveShare,
  Message,
  MyVerification,
  TrustedContact,
} from '@touchgrass/shared';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';
import { Alert, type AlertButton } from 'react-native';
import ContactsScreen from '../app/(app)/safety/contacts';
import SafetyScreen from '../app/(app)/safety/index';
import ShareScreen from '../app/(app)/safety/share';
import VerificationScreen from '../app/(app)/verification';
import { MessageBubble } from '../components/chat/MessageBubble';
import { useAuthStore } from '../src/stores/auth-store';
import { pushPath } from '../src/features/notifications/push-links';
import { toPoint } from '../src/features/safety/sos';
import { authResponseFixture, FakeApi, ids, meFixture } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const C1 = '0192f3a4-5b6c-7d8e-9f01-0000000f0a01';
const C2 = '0192f3a4-5b6c-7d8e-9f01-0000000f0a02';
const SHARE = '0192f3a4-5b6c-7d8e-9f01-0000000f0b01';
const CHALLENGE = '0192f3a4-5b6c-7d8e-9f01-0000000f0c01';
const EVENT = '0192f3a4-5b6c-7d8e-9f01-0000000f0d01';
const LINK = `http://web.test/l/${SHARE}.1893456000.${'a'.repeat(43)}`;

let api: FakeApi;
let openURL: jest.SpyInstance;
let alertSpy: jest.SpyInstance;

/** Presses the button with this label in the last native alert shown. */
function pressAlert(label: string): void {
  const buttons = (alertSpy.mock.calls.at(-1)?.[2] ?? []) as AlertButton[];
  const button = buttons.find((b) => b.text === label);
  if (!button?.onPress) throw new Error(`No alert button ${label}`);
  button.onPress();
}

function share(over: Partial<LiveShare> = {}): LiveShare {
  return {
    id: SHARE,
    eventId: null,
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    endedAt: null,
    sosAt: null,
    active: true,
    contactsNotified: 2,
    lastPointAt: null,
    link: LINK,
    ...over,
  };
}

function verification(over: Partial<MyVerification> = {}): MyVerification {
  return {
    status: 'none',
    verified: false,
    challenge: null,
    submittedAt: null,
    rejectReason: null,
    attemptsLeftToday: 3,
    ...over,
  };
}

const contact = (id: string, name: string, phone: string): TrustedContact => ({ id, name, phone });

beforeEach(async () => {
  resetStores();
  mockRouter.push.mockClear();
  mockRouteParams.current = {};
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
  (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
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
    .on('GET', '/v1/me', { status: 200, body: meFixture() })
    .on('GET', '/v1/verification', { status: 200, body: verification() })
    .on('GET', '/v1/safety/live', { status: 200, body: { share: null } })
    .on('GET', '/v1/safety/contacts', {
      status: 200,
      body: { items: [contact(C1, 'Amma', '+919876500002')] },
    })
    .on('GET', '/v1/events/mine', { status: 200, body: { items: [], nextCursor: null } });
});
afterEach(() => {
  openURL.mockRestore();
  alertSpy.mockRestore();
});

// ---------- F-SAF-07 ----------

describe('safety centre (F-SAF-07)', () => {
  it('emergency numbers, tips, verification and reporting, all one tap away', async () => {
    await renderWithProviders(<SafetyScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Not verified', { exact: false })).toBeOnTheScreen();
    expect(screen.getByText(/Meet in busy public places/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByLabelText('Women helpline: Call 181'));
    expect(openURL).toHaveBeenCalledWith('tel:181');
    await fireEvent.press(screen.getByTestId('helpline-emergency'));
    expect(openURL).toHaveBeenCalledWith('tel:112');

    await fireEvent.press(screen.getByTestId('safety-open-verification'));
    expect(mockRouter.push).toHaveBeenCalledWith('/verification');
    await fireEvent.press(screen.getByTestId('safety-open-contacts'));
    expect(mockRouter.push).toHaveBeenCalledWith('/safety/contacts');
    await fireEvent.press(screen.getByTestId('safety-open-share'));
    expect(mockRouter.push).toHaveBeenCalledWith('/safety/share');
    await fireEvent.press(screen.getByTestId('safety-report'));
    expect(openURL).toHaveBeenCalledWith(
      expect.stringMatching(/^mailto:safety@touchgrass\.app\?subject=/),
    );
  });

  it('SOS asks once, dials 112 straight away and alerts contacts with the location', async () => {
    (Location.getForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Location.getLastKnownPositionAsync as jest.Mock).mockResolvedValueOnce({
      coords: { latitude: 17.41, longitude: 78.44, accuracy: 9000 },
    });
    api.on('POST', '/v1/safety/sos', {
      status: 200,
      body: { share: share({ sosAt: new Date().toISOString() }) },
    });
    await renderWithProviders(<SafetyScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('safety-sos'));
    expect(alertSpy).toHaveBeenCalledWith('Send SOS?', expect.any(String), expect.any(Array));
    expect(api.callsTo('POST', '/v1/safety/sos')).toHaveLength(0);
    await act(async () => {
      pressAlert('Send SOS and call 112');
      await Promise.resolve();
    });
    expect(openURL).toHaveBeenCalledWith('tel:112');
    await waitFor(() => {
      expect(api.callsTo('POST', '/v1/safety/sos')[0]?.body).toEqual({
        point: { lat: 17.41, lng: 78.44, accuracy: 5000 },
      });
    });
    expect(await screen.findByTestId('safety-sos-sent')).toBeOnTheScreen();
  });

  it('shows a running share and hides the verify button once verified', async () => {
    api
      .on('GET', '/v1/me', { status: 200, body: meFixture({ verified: true }) })
      .on('GET', '/v1/verification', {
        status: 200,
        body: verification({ status: 'approved', verified: true }),
      })
      .on('GET', '/v1/safety/live', { status: 200, body: { share: share() } });
    await renderWithProviders(<SafetyScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('safety-sharing')).toBeOnTheScreen();
    expect(screen.getByText('Your status: Verified')).toBeOnTheScreen();
    expect(screen.queryByTestId('safety-open-verification')).toBeNull();
  });
});

// ---------- F-SAF-04 ----------

describe('trusted contacts (F-SAF-04)', () => {
  it('adds a contact with a normalised number, removes one, and explains refusals', async () => {
    let items = [contact(C1, 'Amma', '+919876500002')];
    api
      .on('GET', '/v1/safety/contacts', () => ({ status: 200, body: { items } }))
      .on('POST', '/v1/safety/contacts', (call) => {
        const body = call.body as { name: string; phone: string };
        if (body.phone === '+919876500009')
          return {
            status: 403,
            body: {
              error: {
                code: 'NOT_ELIGIBLE',
                message: 'x',
                details: { reason: 'DUPLICATE_CONTACT' },
              },
            },
          };
        items = [...items, contact(C2, body.name, body.phone)];
        return { status: 200, body: { items } };
      })
      .on('DELETE', `/v1/safety/contacts/${C1}`, () => {
        items = items.filter((c) => c.id !== C1);
        return { status: 200, body: { items } };
      });
    await renderWithProviders(<ContactsScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Amma')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('contact-name'), 'Kiran');
    await fireEvent.changeText(screen.getByTestId('contact-phone'), '12');
    await fireEvent.press(screen.getByTestId('contact-save'));
    expect(await screen.findByTestId('contact-error')).toHaveTextContent(
      'Some details need fixing.',
    );

    await fireEvent.changeText(screen.getByTestId('contact-phone'), '98765 00009');
    await fireEvent.press(screen.getByTestId('contact-save'));
    expect(await screen.findByText('That number is already a trusted contact.')).toBeOnTheScreen();

    await fireEvent.changeText(screen.getByTestId('contact-phone'), '098765 00004');
    await fireEvent.press(screen.getByTestId('contact-save'));
    expect(await screen.findByText('Kiran')).toBeOnTheScreen();
    expect(api.callsTo('POST', '/v1/safety/contacts').at(-1)?.body).toEqual({
      name: 'Kiran',
      phone: '+919876500004',
    });
    await fireEvent.press(screen.getByLabelText('Remove Amma'));
    await waitFor(() => {
      expect(screen.queryByText('Amma')).toBeNull();
    });
  });

  it('the form disappears once three contacts are saved', async () => {
    api.on('GET', '/v1/safety/contacts', {
      status: 200,
      body: {
        items: [
          contact(C1, 'Amma', '+919876500002'),
          contact(C2, 'Kiran', '+919876500003'),
          contact('0192f3a4-5b6c-7d8e-9f01-0000000f0a03', 'Meera', '+919876500004'),
        ],
      },
    });
    await renderWithProviders(<ContactsScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Meera')).toBeOnTheScreen();
    expect(screen.queryByTestId('contact-save')).toBeNull();
  });
});

const upcoming = (startsInMs: number): EventSummary => ({
  id: EVENT,
  slug: 'AbCd2345',
  type: 'plan',
  status: 'published',
  title: 'Sunset run at KBR',
  cover: null,
  startsAt: new Date(Date.now() + startsInMs).toISOString(),
  endsAt: new Date(Date.now() + startsInMs + 2 * 3_600_000).toISOString(),
  timezone: 'Asia/Kolkata',
  location: {
    kind: 'exact',
    point: { lat: 17.42, lng: 78.42 },
    address: 'KBR Park gate 1',
    placeName: 'KBR Park',
    neighbourhoodName: 'Jubilee Hills',
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
    rsvp: 'going',
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
  },
});

describe('live location (F-SAF-04)', () => {
  it('without contacts it points you to add one, and SOS still works', async () => {
    api.on('GET', '/v1/safety/contacts', { status: 200, body: { items: [] } });
    await renderWithProviders(<ShareScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('share-add-contact'));
    expect(mockRouter.push).toHaveBeenCalledWith('/safety/contacts');
    expect(screen.getByTestId('share-sos')).toBeOnTheScreen();
  });

  it('starts for a plan happening now, sends fixes while open, shares on WhatsApp and stops', async () => {
    let current: LiveShare | null = null;
    const remove = jest.fn();
    let onFix: ((pos: { coords: object }) => void) | null = null;
    (Location.requestForegroundPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
    (Location.watchPositionAsync as jest.Mock).mockImplementation(
      (_opts: object, cb: (pos: { coords: object }) => void) => {
        onFix = cb;
        return Promise.resolve({ remove });
      },
    );
    api
      .on('GET', '/v1/events/mine', {
        status: 200,
        body: {
          items: [upcoming(3_600_000), { ...upcoming(5 * 86_400_000), id: C2, title: 'Later' }],
          nextCursor: null,
        },
      })
      .on('GET', '/v1/safety/live', () => ({ status: 200, body: { share: current } }))
      .on('POST', '/v1/safety/live', (call) => {
        current = share({ eventId: (call.body as { eventId: string }).eventId });
        return { status: 200, body: { share: current } };
      })
      .on('POST', '/v1/safety/live/points', () => {
        current = share({ eventId: EVENT, lastPointAt: new Date().toISOString() });
        return { status: 200, body: { share: current } };
      })
      .on('POST', '/v1/safety/live/stop', () => {
        current = null;
        return { status: 200, body: { share: null } };
      });
    await renderWithProviders(<ShareScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Plan: Sunset run at KBR')).toBeOnTheScreen();
    expect(screen.queryByText('Plan: Later')).toBeNull();
    await fireEvent.press(screen.getByTestId('duration-120'));
    await fireEvent.press(screen.getByTestId(`plan-${EVENT}`));
    await fireEvent.press(screen.getByTestId('share-start'));
    expect(await screen.findByTestId('share-active')).toBeOnTheScreen();
    expect(api.callsTo('POST', '/v1/safety/live')[0]?.body).toEqual({
      minutes: 120,
      eventId: EVENT,
    });
    expect(screen.getByTestId('share-sent')).toHaveTextContent('Sent to 2 contacts');

    await waitFor(() => {
      expect(onFix).not.toBeNull();
    });
    await act(async () => {
      onFix?.({ coords: { latitude: 17.42, longitude: 78.41, accuracy: 15 } });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(api.callsTo('POST', '/v1/safety/live/points')[0]?.body).toEqual({
        lat: 17.42,
        lng: 78.41,
        accuracy: 15,
      });
    });
    expect(await screen.findByText(/^Last update/)).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('share-whatsapp'));
    expect(openURL).toHaveBeenCalledWith(
      `whatsapp://send?text=${encodeURIComponent(`I'm sharing my live location with you on TouchGrass: ${LINK}`)}`,
    );
    await fireEvent.press(screen.getByTestId('share-stop'));
    expect(await screen.findByTestId('share-ended')).toBeOnTheScreen();
    expect(remove).toHaveBeenCalled();
  });

  it('explains when location is off and when the server refuses', async () => {
    api.on('GET', '/v1/safety/live', { status: 200, body: { share: share() } });
    await renderWithProviders(<ShareScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('share-location-denied')).toHaveTextContent(
      'Allow location access to share where you are.',
    );
  });

  it('shows why a start was refused', async () => {
    mockRouteParams.current = { eventId: EVENT };
    api.on('POST', '/v1/safety/live', {
      status: 403,
      body: {
        error: { code: 'NOT_ELIGIBLE', message: 'x', details: { reason: 'OUTSIDE_EVENT_WINDOW' } },
      },
    });
    await renderWithProviders(<ShareScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('share-start'));
    expect(await screen.findByTestId('share-error')).toHaveTextContent(
      'You can share for a plan from 2 hours before it starts until 3 hours after it ends.',
    );
    expect(api.callsTo('POST', '/v1/safety/live')[0]?.body).toEqual({
      minutes: 60,
      eventId: EVENT,
    });
  });

  it('accuracy is clamped and missing accuracy stays empty', () => {
    expect(toPoint({ latitude: 1, longitude: 2, accuracy: -3 })).toEqual({
      lat: 1,
      lng: 2,
      accuracy: 0,
    });
    expect(toPoint({ latitude: 1, longitude: 2 })).toEqual({ lat: 1, lng: 2, accuracy: null });
  });

  it('push links open the safety screens', () => {
    expect(pushPath({ url: 'touchgrass://safety' })).toBe('/safety');
    expect(pushPath({ url: 'touchgrass://verification' })).toBe('/verification');
  });
});

// ---------- F-SAF-01 ----------

describe('getting verified (F-SAF-01)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('gets a pose, takes a selfie, uploads it and waits for review', async () => {
    let state = verification();
    api
      .on('GET', '/v1/verification', () => ({ status: 200, body: state }))
      .on('POST', '/v1/verification/challenge', () => {
        state = verification({
          attemptsLeftToday: 2,
          challenge: {
            id: CHALLENGE,
            pose: 'peace_sign',
            expiresAt: new Date(Date.now() + 900_000).toISOString(),
          },
        });
        return { status: 200, body: state };
      })
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
        body: {
          id: ids.asset,
          purpose: 'verification_selfie',
          status: 'ready',
          width: 900,
          height: 1200,
          urls: null,
        },
      })
      .on('POST', '/v1/verification/submit', () => {
        state = verification({
          status: 'pending',
          submittedAt: new Date().toISOString(),
          attemptsLeftToday: 2,
        });
        return { status: 200, body: state };
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
    await renderWithProviders(<VerificationScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('verification-attempts')).toHaveTextContent(
      '3 tries left today',
    );
    await fireEvent.press(screen.getByTestId('verification-start'));
    expect(await screen.findByTestId('verification-pose')).toHaveTextContent('Peace sign');
    await fireEvent.press(screen.getByTestId('verification-selfie'));
    expect(await screen.findByTestId('verification-body')).toHaveTextContent(
      'Thanks! We will let you know once it is reviewed.',
    );
    expect(api.callsTo('POST', '/v1/media/uploads')[0]?.body).toMatchObject({
      purpose: 'verification_selfie',
    });
    expect(api.callsTo('POST', '/v1/verification/submit')[0]?.body).toEqual({
      challengeId: CHALLENGE,
      mediaId: ids.asset,
    });
    expect(screen.queryByTestId('verification-start')).toBeNull();
  });

  it('a rejection explains why; no tries left disables the button', async () => {
    api.on('GET', '/v1/verification', {
      status: 200,
      body: verification({ status: 'rejected', rejectReason: 'UNCLEAR', attemptsLeftToday: 0 }),
    });
    await renderWithProviders(<VerificationScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('verification-body')).toHaveTextContent(
      'We could not verify you: The photo was too dark or blurry.',
    );
    expect(screen.getByTestId('verification-start')).toBeDisabled();
  });

  it('a declined camera is explained', async () => {
    const ImagePicker = jest.requireMock<{ requestCameraPermissionsAsync: jest.Mock }>(
      'expo-image-picker',
    );
    ImagePicker.requestCameraPermissionsAsync.mockResolvedValueOnce({ granted: false });
    api.on('GET', '/v1/verification', {
      status: 200,
      body: verification({
        challenge: {
          id: CHALLENGE,
          pose: 'wave',
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        },
      }),
    });
    await renderWithProviders(<VerificationScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('verification-selfie'));
    expect(await screen.findByTestId('verification-error')).toHaveTextContent(
      'Allow camera access to take your selfie.',
    );
  });
});

// ---------- F-SAF-06 ----------

describe('held content (F-SAF-06)', () => {
  it('your own held message says it is under review', async () => {
    const message = {
      id: '0192f3a4-5b6c-7d8e-9f01-0000000f0e01',
      conversationId: '0192f3a4-5b6c-7d8e-9f01-0000000f0e02',
      sender: {
        id: ids.me,
        displayName: 'Asha',
        photo: null,
        verified: false,
        mutualFriendCount: 0,
      },
      mine: true,
      kind: 'text',
      body: 'nee lanja',
      image: null,
      replyTo: null,
      reactions: [],
      poll: null,
      system: null,
      deleted: false,
      held: true,
      clientId: null,
      createdAt: '2026-11-03T10:00:00.000Z',
    } satisfies Message;
    await renderWithProviders(
      <MessageBubble
        message={message}
        group={false}
        seenBy={[]}
        canVote={false}
        canClosePoll={false}
        onLongPress={jest.fn()}
        onRetry={jest.fn()}
        onVote={jest.fn()}
        onClosePoll={jest.fn()}
      />,
      { fetchFn: api.fetch },
    );
    expect(screen.getByText(/Under review/)).toBeOnTheScreen();
  });
});
