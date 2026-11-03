import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import type {
  ConversationSummary,
  EventDetail,
  IcebreakerCard,
  Message,
  PollView,
} from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import { IcebreakerOverlay } from '../components/at-event/IcebreakerOverlay';
import { EventTogetherTools } from '../components/at-event/EventTogetherTools';
import ChatsScreen from '../app/(app)/(tabs)/chats';
import ThreadScreen from '../app/(app)/chats/[id]/index';
import NewPollScreen from '../app/(app)/chats/[id]/poll';
import IcebreakersScreen from '../app/(app)/events/[id]/icebreakers';
import NewcomersScreen from '../app/(app)/events/[id]/newcomers';
import SignalScreen from '../app/(app)/events/[id]/signal';
import UserProfileScreen from '../app/(app)/users/[id]';
import { RealtimeConnector, useRealtime } from '../src/features/chat/realtime';
import { newClientId, useOutbox } from '../src/features/chat/outbox';
import { pushPath } from '../src/features/notifications/push-links';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids } from '../test/fake-api';
import { resetSockets, socketFor } from '../test/socket-mock';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const CONV = '0192f3a4-5b6c-7d8e-9f01-0000000c0001';
const EVENT_CONV = '0192f3a4-5b6c-7d8e-9f01-0000000c0002';
const EVENT_ID = '0192f3a4-5b6c-7d8e-9f01-00000000e001';
const POLL = '0192f3a4-5b6c-7d8e-9f01-0000000a0001';
const OPT_A = '0192f3a4-5b6c-7d8e-9f01-0000000b0001';
const OPT_B = '0192f3a4-5b6c-7d8e-9f01-0000000b0002';

const person = (id: string, displayName: string) => ({
  id,
  displayName,
  photo: null,
  verified: false,
  mutualFriendCount: 0,
});
const rohan = person(ids.other, 'Rohan K.');
const me = person(ids.me, 'Priya R.');

function conversation(overrides: Partial<ConversationSummary> = {}): ConversationSummary {
  return {
    id: CONV,
    kind: 'direct',
    state: 'active',
    title: 'Rohan K.',
    avatar: null,
    peer: rohan,
    eventId: null,
    lastMessage: {
      senderName: 'Rohan K.',
      kind: 'text',
      excerpt: 'See you at the lake',
      createdAt: '2026-11-03T10:00:00.000Z',
    },
    unreadCount: 2,
    muted: false,
    readOnly: false,
    canCreatePoll: false,
    opensAt: null,
    closesAt: null,
    ...overrides,
  };
}

let seq = 0;
function message(overrides: Partial<Message> = {}): Message {
  seq += 1;
  return {
    id: `0192f3a4-5b6c-7d8e-9f01-0000000d${String(seq).padStart(4, '0')}`,
    conversationId: CONV,
    sender: rohan,
    mine: false,
    kind: 'text',
    body: `Message ${String(seq)}`,
    image: null,
    replyTo: null,
    reactions: [],
    poll: null,
    system: null,
    deleted: false,
    held: false,
    clientId: null,
    createdAt: '2026-11-03T10:00:00.000Z',
    ...overrides,
  };
}

function poll(overrides: Partial<PollView> = {}): PollView {
  return {
    id: POLL,
    conversationId: EVENT_CONV,
    question: 'Chai or coffee after?',
    multi: false,
    anonymous: false,
    closesAt: null,
    closed: false,
    options: [
      { id: OPT_A, text: 'Chai', votes: 1, mine: false, voters: [rohan] },
      { id: OPT_B, text: 'Coffee', votes: 0, mine: false, voters: [] },
    ],
    totalVoters: 1,
    ...overrides,
  };
}

const card = (id: string, en: string): IcebreakerCard => ({
  id,
  prompt: { en, te: `${en} (te)`, hi: `${en} (hi)` },
  category: 'light',
  active: true,
});
const CARD_1 = card('0192f3a4-5b6c-7d8e-9f01-0000000f0001', 'Best biryani in town?');
const CARD_2 = card(
  '0192f3a4-5b6c-7d8e-9f01-0000000f0002',
  'Your favourite Hyderabad sunset spot?',
);

function eventFixture(viewer: Partial<EventDetail['viewer']> = {}): EventDetail {
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
      rsvp: 'going',
      isHost: false,
      hostRole: null,
      invitedBy: null,
      offer: null,
      plusOne: null,
      waitlistPosition: null,
      canRsvp: false,
      blockedReason: 'ALREADY_IN',
      canCheckIn: false,
      payment: null,
      cooldownUntil: null,
      ...viewer,
    },
    description: 'Bring water.',
    hosts: [{ person: rohan, role: 'host' }],
    interests: [],
    vibeTags: [],
    minGroupSize: 2,
    allowPlusOnes: false,
    balancedMaxSharePct: null,
    soloPercent: 50,
    cancelledReason: null,
    shareUrl: 'http://web.test/e/AbCd2345',
    refundPolicy: null,
    perks: [],
    lore: null,
    crew: null,
    held: false,
  };
}

let api: FakeApi;
let uuid = 0;
beforeEach(async () => {
  resetStores();
  resetSockets();
  useOutbox.setState({ items: [], hydrated: true });
  useRealtime.setState({ chat: null, events: null, typing: {}, icebreaker: null });
  mockRouter.push.mockClear();
  jest.mocked(Crypto.randomUUID).mockImplementation(() => {
    uuid += 1;
    return `11111111-2222-4333-8444-${String(uuid).padStart(12, '0')}`;
  });
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
  mockRouteParams.current = { id: CONV };
  api = new FakeApi();
});

describe('helpers', () => {
  it('client ids are URL-safe and unique per message', () => {
    expect(newClientId(() => 'aaaa-bbbb')).toBe('maaaabbbb');
    expect(newClientId(() => Crypto.randomUUID())).not.toBe(newClientId(() => Crypto.randomUUID()));
  });
  it('push links only open our own screens', () => {
    expect(pushPath({ url: `touchgrass://chats/${CONV}` })).toBe(`/chats/${CONV}`);
    expect(pushPath({ url: 'https://evil.test/chats/1' })).toBeNull();
    expect(pushPath({ url: 'touchgrass://chats/1?x=<script>' })).toBeNull();
    expect(pushPath({})).toBeNull();
    expect(pushPath(null)).toBeNull();
  });
});

describe('chats inbox (F-CHT-04)', () => {
  it('lists conversations with unread counts and keeps requests on their own tab', async () => {
    const request = conversation({
      id: EVENT_CONV,
      state: 'request_received',
      title: 'Sneha P.',
      unreadCount: 1,
      lastMessage: {
        senderName: 'Sneha P.',
        kind: 'text',
        excerpt: 'Hi! Saw you at frisbee',
        createdAt: '2026-11-03T09:00:00.000Z',
      },
    });
    api.on('GET', '/v1/chats', (c) => ({
      status: 200,
      body: {
        items: c.url.includes('filter=requests') ? [request] : [conversation()],
        nextCursor: null,
      },
    }));
    await renderWithProviders(<ChatsScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('See you at the lake')).toBeOnTheScreen();
    expect(screen.getByTestId(`conv-${CONV}`)).toHaveProp(
      'accessibilityLabel',
      expect.stringContaining('2 unread') as string,
    );
    await fireEvent.press(screen.getByTestId(`conv-${CONV}`));
    expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/chats/[id]', params: { id: CONV } });

    await fireEvent.press(screen.getByRole('tab', { name: /Requests/ }));
    expect(await screen.findByText('Hi! Saw you at frisbee')).toBeOnTheScreen();
  });

  it('shows an empty state', async () => {
    api.on('GET', '/v1/chats', { status: 200, body: { items: [], nextCursor: null } });
    await renderWithProviders(<ChatsScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText(/No chats yet/)).toBeOnTheScreen();
  });
});

describe('thread (F-CHT-01, F-CHT-04)', () => {
  const page = (items: Message[], readBy: { userId: string; messageId: string }[] = []) => ({
    status: 200,
    body: { items, nextCursor: null, readBy },
  });

  it('sends with a client id, marks read, shows receipts and live messages and typing', async () => {
    const mine = message({ mine: true, sender: me, body: 'On my way' });
    const theirs = message({ body: 'Running 5 late' });
    api
      .on('GET', `/v1/chats/${CONV}`, { status: 200, body: conversation() })
      .on(
        'GET',
        `/v1/chats/${CONV}/messages`,
        page([theirs, mine], [{ userId: ids.other, messageId: mine.id }]),
      )
      .on('POST', `/v1/chats/${CONV}/read`, { status: 204 })
      .on('POST', `/v1/chats/${CONV}/messages`, (c) => ({
        status: 201,
        body: message({
          mine: true,
          sender: me,
          body: (c.body as { body: string }).body,
          clientId: (c.body as { clientId: string }).clientId,
        }),
      }));
    await renderWithProviders(
      <>
        <RealtimeConnector />
        <ThreadScreen />
      </>,
      { fetchFn: api.fetch },
    );
    expect(await screen.findByText('Running 5 late')).toBeOnTheScreen();
    expect(screen.getByText('Seen by Rohan K.')).toBeOnTheScreen();
    await waitFor(() => {
      expect(api.callsTo('POST', `/v1/chats/${CONV}/read`)[0]?.body).toEqual({
        messageId: theirs.id,
      });
    });

    // Presence: the thread joins its room so the server skips push while it is open.
    const chat = socketFor('/chat');
    expect(chat?.emitted).toContainEqual({ event: 'chat:join', payload: { conversationId: CONV } });

    await fireEvent.changeText(screen.getByTestId('composer'), 'Grabbing chai first');
    await fireEvent.press(screen.getByTestId('send'));
    expect(await screen.findByText('Grabbing chai first')).toBeOnTheScreen();
    const sent = api.callsTo('POST', `/v1/chats/${CONV}/messages`)[0]?.body as {
      clientId: string;
      kind: string;
    };
    expect(sent.kind).toBe('text');
    expect(sent.clientId).toMatch(/^m[0-9a-f]{32}$/);
    expect(chat?.emitted.some((e) => e.event === 'chat:typing')).toBe(true);
    expect(useOutbox.getState().items).toEqual([]);

    // Server pushes: someone types, then a message arrives live.
    await act(() => {
      chat?.serverPush('typing', {
        conversationId: CONV,
        userId: ids.other,
        name: 'Rohan K.',
        typing: true,
      });
    });
    expect(await screen.findByText('Rohan K. is typing…')).toBeOnTheScreen();
    await act(() => {
      chat?.serverPush('message:new', message({ body: 'Parking at gate 2' }));
    });
    expect(await screen.findByText('Parking at gate 2')).toBeOnTheScreen();
    expect(screen.queryByText('Rohan K. is typing…')).toBeNull();
  });

  it('keeps a message offline as failed and resends it with the same client id', async () => {
    let online = false;
    api
      .on('GET', `/v1/chats/${CONV}`, { status: 200, body: conversation({ unreadCount: 0 }) })
      .on('GET', `/v1/chats/${CONV}/messages`, page([]))
      .on('POST', `/v1/chats/${CONV}/messages`, (c) => {
        if (!online) throw new TypeError('Network request failed');
        return {
          status: 201,
          body: message({
            mine: true,
            sender: me,
            body: 'Hello?',
            clientId: (c.body as { clientId: string }).clientId,
          }),
        };
      });
    await renderWithProviders(<ThreadScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(await screen.findByTestId('composer'), 'Hello?');
    await fireEvent.press(screen.getByTestId('send'));
    expect(await screen.findByText(/Not sent/)).toBeOnTheScreen();
    expect(useOutbox.getState().items[0]?.status).toBe('failed');

    online = true;
    const pending = useOutbox.getState().items[0];
    await fireEvent.press(screen.getByTestId(`pending-${pending?.clientId ?? ''}`));
    await waitFor(() => {
      expect(useOutbox.getState().items).toEqual([]);
    });
    const posts = api.callsTo('POST', `/v1/chats/${CONV}/messages`);
    expect(posts).toHaveLength(2);
    expect((posts[0]?.body as { clientId: string }).clientId).toBe(
      (posts[1]?.body as { clientId: string }).clientId,
    );
    expect(await screen.findByText('Hello?')).toBeOnTheScreen();
  });

  it('replies, reacts and deletes from the message menu', async () => {
    const theirs = message({ body: 'Who is bringing the disc?' });
    api
      .on('GET', `/v1/chats/${CONV}`, { status: 200, body: conversation({ unreadCount: 0 }) })
      .on('GET', `/v1/chats/${CONV}/messages`, page([theirs]))
      .on('POST', `/v1/chats/${CONV}/read`, { status: 204 })
      .on('POST', new RegExp(`^/v1/chats/${CONV}/messages/.+/reactions$`), { status: 204 })
      .on('DELETE', new RegExp(`^/v1/chats/${CONV}/messages/.+$`), { status: 204 })
      .on('POST', `/v1/chats/${CONV}/messages`, (c) => ({
        status: 201,
        body: message({
          mine: true,
          sender: me,
          body: 'Me!',
          replyTo: { id: theirs.id, senderName: 'Rohan K.', excerpt: 'Who is bringing the disc?' },
          clientId: (c.body as { clientId: string }).clientId,
        }),
      }));
    await renderWithProviders(<ThreadScreen />, { fetchFn: api.fetch });
    await fireEvent(await screen.findByTestId(`msg-${theirs.id}`), 'longPress');
    await fireEvent.press(screen.getByTestId('react-🙌'));
    await waitFor(() => {
      expect(api.calls.some((c) => c.path.endsWith('/reactions') && c.method === 'POST')).toBe(
        true,
      );
    });
    expect(api.calls.find((c) => c.path.endsWith('/reactions'))?.body).toEqual({ emoji: '🙌' });

    await fireEvent(screen.getByTestId(`msg-${theirs.id}`), 'longPress');
    await fireEvent.press(screen.getByTestId('reply'));
    expect(screen.getByText(/Replying to Rohan K./)).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('composer'), 'Me!');
    await fireEvent.press(screen.getByTestId('send'));
    await waitFor(() => {
      expect(api.callsTo('POST', `/v1/chats/${CONV}/messages`)[0]?.body).toMatchObject({
        replyToId: theirs.id,
      });
    });

    await fireEvent(screen.getByTestId(`msg-${theirs.id}`), 'longPress');
    expect(screen.queryByTestId('delete-everyone')).toBeNull();
    await fireEvent.press(screen.getByTestId('delete-me'));
    await waitFor(() => {
      expect(api.calls.find((c) => c.method === 'DELETE')?.url).toContain('scope=me');
    });
  });

  it('message requests: the recipient accepts; the sender waits', async () => {
    api
      .on('GET', `/v1/chats/${CONV}`, {
        status: 200,
        body: conversation({ state: 'request_received' }),
      })
      .on('GET', `/v1/chats/${CONV}/messages`, page([message({ body: 'Hi from frisbee!' })]))
      .on('POST', `/v1/chats/${CONV}/read`, { status: 204 })
      .on('POST', `/v1/chats/${CONV}/request`, { status: 200, body: conversation() });
    await renderWithProviders(<ThreadScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('request-banner')).toBeOnTheScreen();
    expect(screen.queryByTestId('composer')).toBeNull();
    await fireEvent.press(screen.getByTestId('accept-request'));
    await waitFor(() => {
      expect(api.callsTo('POST', `/v1/chats/${CONV}/request`)[0]?.body).toEqual({ accept: true });
    });
  });

  it('event chats before they open are read-only with the opening time', async () => {
    api
      .on('GET', `/v1/chats/${CONV}`, {
        status: 200,
        body: conversation({
          kind: 'event',
          peer: null,
          eventId: EVENT_ID,
          title: 'Sunset frisbee',
          readOnly: true,
          opensAt: '2099-11-02T12:30:00.000Z',
          closesAt: '2099-11-05T14:30:00.000Z',
        }),
      })
      .on('GET', `/v1/chats/${CONV}/messages`, page([]));
    await renderWithProviders(<ThreadScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('readonly-banner')).toHaveTextContent(/Chat opens/);
    expect(screen.queryByTestId('composer')).toBeNull();
  });
});

describe('polls (F-CHT-05)', () => {
  it('hosts create polls; validation catches duplicates', async () => {
    api.on('POST', `/v1/chats/${CONV}/polls`, (c) => ({
      status: 201,
      body: message({
        mine: true,
        sender: me,
        kind: 'poll',
        body: null,
        poll: poll({ question: (c.body as { question: string }).question, conversationId: CONV }),
      }),
    }));
    await renderWithProviders(<NewPollScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('poll-question'), 'Chai or coffee after?');
    await fireEvent.changeText(screen.getByTestId('poll-option-input-0'), 'Chai');
    await fireEvent.changeText(screen.getByTestId('poll-option-input-1'), 'chai');
    await fireEvent.press(screen.getByTestId('create-poll'));
    expect(await screen.findByTestId('poll-error')).toBeOnTheScreen();
    expect(api.callsTo('POST', `/v1/chats/${CONV}/polls`)).toHaveLength(0);

    await fireEvent.changeText(screen.getByTestId('poll-option-input-1'), 'Coffee');
    await fireEvent.press(screen.getByTestId('create-poll'));
    await waitFor(() => {
      expect(api.callsTo('POST', `/v1/chats/${CONV}/polls`)[0]?.body).toMatchObject({
        question: 'Chai or coffee after?',
        options: ['Chai', 'Coffee'],
      });
    });
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('members vote in the thread', async () => {
    mockRouteParams.current = { id: EVENT_CONV };
    const pollMessage = message({
      conversationId: EVENT_CONV,
      kind: 'poll',
      body: null,
      poll: poll(),
    });
    api
      .on('GET', `/v1/chats/${EVENT_CONV}`, {
        status: 200,
        body: conversation({
          id: EVENT_CONV,
          kind: 'event',
          peer: null,
          title: 'Sunset frisbee',
          unreadCount: 0,
        }),
      })
      .on('GET', `/v1/chats/${EVENT_CONV}/messages`, {
        status: 200,
        body: { items: [pollMessage], nextCursor: null, readBy: [] },
      })
      .on('POST', `/v1/chats/${EVENT_CONV}/read`, { status: 204 })
      .on('POST', `/v1/polls/${POLL}/votes`, {
        status: 200,
        body: poll({
          options: [
            { id: OPT_A, text: 'Chai', votes: 2, mine: true, voters: [rohan, me] },
            { id: OPT_B, text: 'Coffee', votes: 0, mine: false, voters: [] },
          ],
          totalVoters: 2,
        }),
      });
    await renderWithProviders(<ThreadScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Chai or coffee after?')).toBeOnTheScreen();
    expect(screen.queryByTestId('new-poll')).toBeNull();
    await fireEvent.press(screen.getByTestId(`poll-option-${OPT_A}`));
    await waitFor(() => {
      expect(api.callsTo('POST', `/v1/polls/${POLL}/votes`)[0]?.body).toEqual({
        optionIds: [OPT_A],
      });
    });
  });
});

describe('at the plan (F-ATE-01..03)', () => {
  beforeEach(() => {
    mockRouteParams.current = { id: EVENT_ID };
  });

  it('opens the plan chat and listens for host pushes', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}/chat`, {
      status: 200,
      body: conversation({ id: EVENT_CONV, kind: 'event', peer: null, unreadCount: 3 }),
    });
    await renderWithProviders(
      <>
        <RealtimeConnector />
        <IcebreakerOverlay />
        <EventTogetherTools event={eventFixture()} />
      </>,
      { fetchFn: api.fetch },
    );
    await fireEvent.press(await screen.findByText(/Open chat · 3 unread/));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/chats/[id]',
      params: { id: EVENT_CONV },
    });
    expect(screen.queryByTestId('open-newcomers')).toBeNull();
    const events = socketFor('/events');
    expect(events?.emitted).toContainEqual({
      event: 'event:join',
      payload: { eventId: EVENT_ID },
    });

    await act(() => {
      events?.serverPush('icebreaker:show', { eventId: EVENT_ID, card: CARD_1 });
    });
    expect(await screen.findByText('Best biryani in town?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('dismiss-icebreaker'));
    expect(useRealtime.getState().icebreaker).toBeNull();
  });

  const threadPage = (items: Message[]) => ({
    status: 200,
    body: { items, nextCursor: null, readBy: [] },
  });
  const photo = {
    sm: 'https://media.test/p/sm.webp',
    md: 'https://media.test/p/md.webp',
    lg: 'https://media.test/p/lg.webp',
  };

  it('previews the latest plan messages right under Pull up, oldest first', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}/chat`, {
        status: 200,
        body: conversation({ id: EVENT_CONV, kind: 'event', peer: null, unreadCount: 0 }),
      })
      .on(
        'GET',
        `/v1/chats/${EVENT_CONV}/messages`,
        threadPage([
          message({ conversationId: EVENT_CONV, mine: true, sender: null, body: 'On my way' }),
          message({ conversationId: EVENT_CONV, body: null, image: photo }),
          message({ conversationId: EVENT_CONV, body: 'Table by the window' }),
          message({ conversationId: EVENT_CONV, body: 'Too old for the preview' }),
        ]),
      );
    await renderWithProviders(<EventTogetherTools event={eventFixture()} />, {
      fetchFn: api.fetch,
    });
    const preview = await screen.findByTestId('event-chat-preview');
    await waitFor(() => expect(preview).toHaveTextContent(/On my way/));
    const lines = screen.getAllByTestId(/^event-chat-line-/);
    expect(lines[0]).toHaveTextContent(/Table by the window/);
    expect(lines[2]).toHaveTextContent(/On my way/);
    expect(preview).toHaveTextContent(/You\s+On my way/);
    expect(preview).toHaveTextContent(/Photo from Rohan K\./);
    expect(preview).not.toHaveTextContent(/Too old for the preview/);
    expect(screen.getByRole('button', { name: 'Open chat' })).toBeOnTheScreen();
  });

  it('invites the group to say hello when the plan chat is empty', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}/chat`, {
        status: 200,
        body: conversation({ id: EVENT_CONV, kind: 'event', peer: null, unreadCount: 0 }),
      })
      .on('GET', `/v1/chats/${EVENT_CONV}/messages`, threadPage([]));
    await renderWithProviders(<EventTogetherTools event={eventFixture()} />, {
      fetchFn: api.fetch,
    });
    expect(await screen.findByTestId('event-chat-empty')).toHaveTextContent(
      'No messages yet. Say hello to the group.',
    );
  });

  it('hides everything from people without a seat', async () => {
    await renderWithProviders(
      <EventTogetherTools
        event={eventFixture({ rsvp: null, canRsvp: true, blockedReason: null })}
      />,
      { fetchFn: api.fetch },
    );
    expect(screen.queryByTestId('together-tools')).toBeNull();
    expect(api.calls).toHaveLength(0);
  });

  it('icebreaker deck: next, previous, swipe actions and host push', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}/icebreakers`, {
        status: 200,
        body: { items: [CARD_1, CARD_2] },
      })
      .on('GET', `/v1/events/${EVENT_ID}`, {
        status: 200,
        body: eventFixture({ isHost: true, hostRole: 'host', rsvp: null }),
      })
      .on('POST', `/v1/events/${EVENT_ID}/icebreakers/push`, { status: 200, body: CARD_2 });
    await renderWithProviders(<IcebreakersScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Best biryani in town?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('next-card'));
    expect(screen.getByText('Your favourite Hyderabad sunset spot?')).toBeOnTheScreen();
    // Screen readers deliver adjustable actions straight to the element (not a touch), so call the handler.
    const deck = screen.getByTestId('icebreaker-card');
    await act(() => {
      (deck.props as { onAccessibilityAction: (e: object) => void }).onAccessibilityAction({
        nativeEvent: { actionName: 'increment' },
      });
    });
    expect(screen.getByText('Best biryani in town?')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('prev-card'));
    await fireEvent.press(await screen.findByTestId('push-card'));
    expect(await screen.findByTestId('push-notice')).toHaveTextContent("On everyone's screens now");
    expect(api.callsTo('POST', `/v1/events/${EVENT_ID}/icebreakers/push`)[0]?.body).toEqual({
      cardId: CARD_2.id,
    });
  });

  it('guests do not get the push button; the deck follows the app language', async () => {
    api
      .on('GET', `/v1/events/${EVENT_ID}/icebreakers`, { status: 200, body: { items: [CARD_1] } })
      .on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: eventFixture() });
    await renderWithProviders(<IcebreakersScreen />, { fetchFn: api.fetch, language: 'te' });
    expect(await screen.findByText('Best biryani in town? (te)')).toBeOnTheScreen();
    await waitFor(() => {
      expect(api.callsTo('GET', `/v1/events/${EVENT_ID}`)).toHaveLength(1);
    });
    expect(screen.queryByTestId('push-card')).toBeNull();
  });

  it('signal shows a named colour and icon, or when it becomes available', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}/signal`, {
      status: 200,
      body: {
        color: '#1A5FD0',
        icon: '🌊',
        colorName: 'blue',
        iconName: 'wave',
        availableFrom: '2026-11-03T12:00:00.000Z',
      },
    });
    const first = await renderWithProviders(<SignalScreen />, { fetchFn: api.fetch });
    expect(await screen.findByRole('header', { name: 'Blue Wave' })).toBeOnTheScreen();
    expect(screen.getByTestId('signal-icon')).toHaveProp('accessibilityLabel', 'Blue Wave');
    await first.unmount();

    api.on('GET', `/v1/events/${EVENT_ID}/signal`, {
      status: 409,
      body: {
        error: {
          code: 'CONFLICT',
          message: 'not yet',
          details: { reason: 'SIGNAL_NOT_YET', availableFrom: '2026-11-03T12:00:00.000Z' },
        },
      },
    });
    await renderWithProviders(<SignalScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('signal-not-yet')).toHaveTextContent(/5:30/);
  });

  it('hosts tick off first-timers', async () => {
    const newbie = person('0192f3a4-5b6c-7d8e-9f01-00000000aaaa', 'Sneha P.');
    api
      .on('GET', `/v1/events/${EVENT_ID}/newcomers`, {
        status: 200,
        body: { items: [{ person: newbie, welcomed: false, welcomedBy: null, checkedIn: true }] },
      })
      .on('PUT', `/v1/events/${EVENT_ID}/newcomers/${newbie.id}`, {
        status: 200,
        body: {
          items: [{ person: newbie, welcomed: true, welcomedBy: 'Priya R.', checkedIn: true }],
        },
      });
    await renderWithProviders(<NewcomersScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId(`welcome-${newbie.id}`));
    expect(await screen.findByText('Welcomed · Priya R.')).toBeOnTheScreen();
    expect(api.callsTo('PUT', `/v1/events/${EVENT_ID}/newcomers/${newbie.id}`)[0]?.body).toEqual({
      welcomed: true,
    });
  });

  it('shows an empty first-timer list', async () => {
    api.on('GET', `/v1/events/${EVENT_ID}/newcomers`, { status: 200, body: { items: [] } });
    await renderWithProviders(<NewcomersScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('No first-timers this time.')).toBeOnTheScreen();
  });
});

describe('profile → message', () => {
  it('starts (or reopens) a direct chat', async () => {
    mockRouteParams.current = { id: ids.other };
    api
      .on('GET', `/v1/users/${ids.other}/profile`, {
        status: 200,
        body: {
          id: ids.other,
          displayName: 'Rohan K.',
          age: null,
          pronouns: null,
          bio: '',
          spokenLanguages: [],
          neighbourhoodName: null,
          photos: [],
          interests: [],
          vibeTags: [],
          stats: { eventsAttended: 0, eventsHosted: 0, reliabilityTier: 'new' },
          verified: false,
          relationship: 'squad',
          sharedInterestIds: [],
          mutualFriends: { count: 0, sample: [] },
          limited: false,
          hostRating: null,
        },
      })
      .on('POST', '/v1/chats/direct', { status: 200, body: conversation() });
    await renderWithProviders(<UserProfileScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('message-user'));
    await waitFor(() => {
      expect(mockRouter.push).toHaveBeenCalledWith({
        pathname: '/chats/[id]',
        params: { id: CONV },
      });
    });
    expect(api.callsTo('POST', '/v1/chats/direct')[0]?.body).toEqual({ userId: ids.other });
  });
});
