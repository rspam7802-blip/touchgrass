import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import {
  type EventDetail,
  NOTIFICATION_TEMPLATES,
  type NotificationItem,
} from '@touchgrass/shared';
import * as Calendar from 'expo-calendar/legacy';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Share } from 'react-native';
import NotificationsScreen from '../app/(app)/notifications';
import CalendarFeedScreen from '../app/(app)/settings/calendar';
import NotificationSettingsScreen from '../app/(app)/settings/notifications';
import ProfileLink from '../app/u/[id]';
import CrewLink from '../app/c/[id]';
import EventStoryScreen from '../app/(app)/events/[id]/story';
import ProfileTab from '../app/(app)/(tabs)/profile';
import { CalendarButton } from '../components/CalendarButton';
import { NotificationBell } from '../components/NotificationBell';
import { storeUrl, UpdatePrompt } from '../components/UpdatePrompt';
import { analytics } from '../src/features/analytics/analytics';
import { calendarFields, isInCalendar, syncCalendarCopy } from '../src/features/calendar/device';
import {
  PushLinkHandler,
  pushNotificationId,
  pushPath,
} from '../src/features/notifications/push-links';
import { PERSIST_BUSTER, shouldPersist } from '../src/lib/query-persist';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids, meFixture } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const EVENT_ID = '0192f3a4-5b6c-7d8e-9f01-00000010e001';
const N1 = '0192f3a4-5b6c-7d8e-9f01-00000010a001';
const N2 = '0192f3a4-5b6c-7d8e-9f01-00000010a002';

let api: FakeApi;
let openURL: jest.SpyInstance;

function item(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: N1,
    kind: 'reminder_day',
    category: 'reminders',
    title: 'Sunset run is coming up',
    body: 'Starts Sun, 8 Nov, 6:00 am. The group chat is open, say hi 👋',
    url: `touchgrass://events/${EVENT_ID}`,
    read: false,
    createdAt: '2026-11-02T10:00:00.000Z',
    ...over,
  };
}

function eventDetail(over: Partial<EventDetail> = {}): EventDetail {
  return {
    id: EVENT_ID,
    slug: 'AbCd2345',
    type: 'plan',
    status: 'published',
    title: 'Sunset run',
    cover: null,
    startsAt: '2026-11-08T00:30:00.000Z',
    endsAt: '2026-11-08T02:30:00.000Z',
    timezone: 'Asia/Kolkata',
    location: {
      kind: 'approximate',
      center: { lat: 17.42, lng: 78.42 },
      radiusMeters: 800,
      neighbourhoodName: 'Jubilee Hills',
      revealsAt: '2026-11-07T22:30:00.000Z',
    },
    visibility: 'public',
    capacity: 10,
    goingCount: 4,
    spotsLeft: 6,
    waitlistCount: 0,
    pricePaise: 0,
    soloFriendly: true,
    smallGroup: false,
    mystery: true,
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
    description: 'Bring water.',
    hosts: [],
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
    ...over,
  };
}

const config = (over: Record<string, unknown> = {}) => ({
  status: 200,
  body: { minSupportedVersion: '0.1.0', latestVersion: '0.1.0', flags: {}, ...over },
});

beforeEach(async () => {
  resetStores();
  mockRouter.push.mockClear();
  mockRouteParams.current = {};
  openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  await AsyncStorage.clear();
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
    .on('GET', '/v1/app/config', config())
    .on('GET', '/v1/me', { status: 200, body: meFixture() })
    .on('POST', '/v1/analytics/events', { status: 202, body: { accepted: 1 } });
});
afterEach(() => {
  openURL.mockRestore();
});

// ---------- F-NOT-01 ----------

describe('notification inbox (F-NOT-01)', () => {
  it('lists newest first, opens what an item is about and marks it read', async () => {
    let items = [
      item(),
      item({
        id: N2,
        kind: 'badge_earned',
        title: 'New badge',
        body: '',
        read: true,
        url: 'touchgrass://badges',
      }),
    ];
    api
      .on('GET', /^\/v1\/notifications$/, () => ({
        status: 200,
        body: { items, unread: items.filter((i) => !i.read).length, nextCursor: null },
      }))
      .on('POST', '/v1/notifications/read', (call) => {
        const body = call.body as { ids?: string[]; all?: true };
        items = items.map((i) => (body.all || body.ids?.includes(i.id) ? { ...i, read: true } : i));
        return { status: 200, body: { unread: items.filter((i) => !i.read).length } };
      });
    await renderWithProviders(<NotificationsScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('notifications-unread')).toHaveTextContent('1 unread');
    const first = screen.getByTestId(`notification-${N1}`);
    expect(first).toHaveAccessibleName(/^1 unread\. Sunset run is coming up\. Starts/);
    await fireEvent.press(first);
    expect(mockRouter.push).toHaveBeenCalledWith(`/events/${EVENT_ID}`);
    await waitFor(() => {
      expect(api.callsTo('POST', '/v1/notifications/read')[0]?.body).toEqual({ ids: [N1] });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('notifications-read-all')).toBeNull();
    });
    await fireEvent.press(screen.getByTestId(`notification-${N2}`));
    expect(mockRouter.push).toHaveBeenCalledWith('/badges');
    expect(api.callsTo('POST', '/v1/notifications/read')).toHaveLength(1);
  });

  it('marks everything read at once; an empty inbox says so', async () => {
    let unread = 2;
    api
      .on('GET', /^\/v1\/notifications$/, () => ({
        status: 200,
        body: { items: unread ? [item(), item({ id: N2 })] : [], unread, nextCursor: null },
      }))
      .on('POST', '/v1/notifications/read', () => {
        unread = 0;
        return { status: 200, body: { unread: 0 } };
      });
    await renderWithProviders(<NotificationsScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('notifications-read-all'));
    expect(api.callsTo('POST', '/v1/notifications/read')[0]?.body).toEqual({ all: true });
    expect(await screen.findByText('Nothing new. Go touch some grass 🌱')).toBeOnTheScreen();
  });

  it('the bell reads the unread count and opens the inbox', async () => {
    api.on('GET', '/v1/notifications/unread', { status: 200, body: { unread: 3 } });
    await renderWithProviders(<NotificationBell />, { fetchFn: api.fetch });
    expect(await screen.findByLabelText('Notifications, 3 unread')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('open-notifications'));
    expect(mockRouter.push).toHaveBeenCalledWith('/notifications');
  });

  it('a tapped push marks its inbox item read and opens its screen', async () => {
    (Notifications.useLastNotificationResponse as jest.Mock).mockReturnValueOnce({
      notification: {
        request: {
          content: { data: { url: `touchgrass://events/${EVENT_ID}`, notificationId: N1 } },
        },
      },
    });
    api.on('POST', '/v1/notifications/read', { status: 200, body: { unread: 0 } });
    await renderWithProviders(<PushLinkHandler />, { fetchFn: api.fetch });
    await waitFor(() => {
      expect(api.callsTo('POST', '/v1/notifications/read')[0]?.body).toEqual({ ids: [N1] });
    });
    expect(mockRouter.push).toHaveBeenCalledWith(`/events/${EVENT_ID}`);
    expect(pushNotificationId({ notificationId: 'nope' })).toBeNull();
    expect(pushNotificationId(null)).toBeNull();
  });

  it('every notification links to a screen that exists (F-PLT-03)', () => {
    const app = join(__dirname, '..', 'app', '(app)');
    // People still onboarding (e.g. waiting for their city to open) land on onboarding screens.
    const onboarding = join(__dirname, '..', 'app', '(onboarding)');
    const exists = (path: string): boolean => {
      const route = path.replace(/\{\{\w+\}\}/g, '[id]');
      return [`${route}.tsx`, `${route}/index.tsx`, `(tabs)/${route}.tsx`].some(
        (f) => existsSync(join(app, f)) || existsSync(join(onboarding, f)),
      );
    };
    for (const [kind, t] of Object.entries(NOTIFICATION_TEMPLATES))
      expect([kind, exists(t.link)]).toEqual([kind, true]);
    expect(exists('notifications')).toBe(true);
    expect(pushPath({ url: 'touchgrass://notifications' })).toBe('/notifications');
  });

  it('quiet hours can be switched off, and edited times must be HH:MM', async () => {
    let quiet = { enabled: true, start: '22:00', end: '08:00' };
    api
      .on('GET', '/v1/me/settings/notifications', { status: 200, body: { items: [] } })
      .on('GET', '/v1/me/settings/quiet-hours', () => ({ status: 200, body: quiet }))
      .on('PUT', '/v1/me/settings/quiet-hours', (call) => {
        quiet = call.body as typeof quiet;
        return { status: 200, body: quiet };
      });
    await renderWithProviders(<NotificationSettingsScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('quiet-start')).toHaveDisplayValue('22:00');
    await fireEvent.changeText(screen.getByTestId('quiet-start'), '9pm');
    expect(screen.getByTestId('quiet-save')).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('quiet-start'), '23:30');
    await fireEvent.press(screen.getByTestId('quiet-save'));
    expect(await screen.findByTestId('quiet-saved')).toBeOnTheScreen();
    expect(api.callsTo('PUT', '/v1/me/settings/quiet-hours')[0]?.body).toEqual({
      enabled: true,
      start: '23:30',
      end: '08:00',
    });
    await fireEvent(screen.getByTestId('quiet-enabled'), 'valueChange', false);
    await waitFor(() => {
      expect(screen.queryByTestId('quiet-start')).toBeNull();
    });
    expect(api.callsTo('PUT', '/v1/me/settings/quiet-hours').at(-1)?.body).toMatchObject({
      enabled: false,
    });
  });
});

// ---------- F-CAL-01 ----------

describe('calendar (F-CAL-01)', () => {
  it('adds a plan to the phone calendar mystery-safely, then keeps it current', async () => {
    const e = eventDetail();
    await renderWithProviders(<CalendarButton event={e} />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByTestId('add-to-calendar'));
    expect(await screen.findByTestId('calendar-result')).toHaveTextContent(
      'Added to your calendar',
    );
    expect(Calendar.createEventAsync).toHaveBeenCalledWith(
      'cal-primary',
      expect.objectContaining({
        title: 'Sunset run',
        location: 'Mystery spot near Jubilee Hills (revealed in the app)',
        timeZone: 'Asia/Kolkata',
      }),
    );
    expect(await isInCalendar(EVENT_ID)).toBe(true);
    await fireEvent.press(screen.getByTestId('add-to-calendar'));
    expect(await screen.findByText('Your calendar is up to date')).toBeOnTheScreen();

    const revealed = eventDetail({
      location: {
        kind: 'exact',
        point: { lat: 17.42, lng: 78.42 },
        address: 'KBR Park gate 1',
        placeName: 'KBR Park',
        neighbourhoodName: 'Jubilee Hills',
      },
    });
    const t = (k: string, o?: Record<string, string>) => `${k}:${JSON.stringify(o ?? {})}`;
    const fields = calendarFields(revealed, t as never, 'http://web.test');
    expect(fields.location).toBe('KBR Park, KBR Park gate 1');
    (Calendar.updateEventAsync as jest.Mock).mockClear();
    expect(await syncCalendarCopy(revealed, fields)).toBe(true);
    expect(Calendar.updateEventAsync).toHaveBeenCalledWith('device-event-1', fields);
    expect(await syncCalendarCopy(revealed, fields)).toBe(false);
    expect(await syncCalendarCopy({ ...revealed, status: 'cancelled' }, fields)).toBe(true);
    expect(Calendar.deleteEventAsync).toHaveBeenCalledWith('device-event-1');
    expect(await isInCalendar(EVENT_ID)).toBe(false);
  });

  it('explains when calendar access is refused', async () => {
    (Calendar.requestCalendarPermissionsAsync as jest.Mock).mockResolvedValueOnce({
      granted: false,
    });
    await renderWithProviders(<CalendarButton event={eventDetail()} />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByTestId('add-to-calendar'));
    expect(await screen.findByTestId('calendar-result')).toHaveTextContent(
      'Allow calendar access to add plans.',
    );
  });

  it('subscribes to the private feed and can reset its link', async () => {
    api
      .on('GET', '/v1/me/calendar', {
        status: 200,
        body: {
          url: 'http://api.test/v1/calendar/abc.ics',
          webcalUrl: 'webcal://api.test/v1/calendar/abc.ics',
        },
      })
      .on('POST', '/v1/me/calendar/reset', {
        status: 200,
        body: {
          url: 'http://api.test/v1/calendar/def.ics',
          webcalUrl: 'webcal://api.test/v1/calendar/def.ics',
        },
      });
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await renderWithProviders(<CalendarFeedScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('calendar-subscribe'));
    expect(openURL).toHaveBeenCalledWith('webcal://api.test/v1/calendar/abc.ics');
    await fireEvent.press(screen.getByTestId('calendar-reset'));
    expect(await screen.findByTestId('calendar-reset-done')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('calendar-share'));
    expect(share).toHaveBeenCalledWith({ message: 'http://api.test/v1/calendar/def.ics' });
    share.mockRestore();
  });
});

// ---------- F-GRW-02, F-PLT-01..05 ----------

describe('sharing, deep links, updates, offline and analytics', () => {
  it('shares your profile link; switched-off features disappear from the profile', async () => {
    api
      .on(
        'GET',
        '/v1/app/config',
        config({ flags: { referrals: false, challenges: true, recaps: true } }),
      )
      .on('GET', '/v1/me/streak', {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'x' } },
      });
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    await renderWithProviders(<ProfileTab />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByTestId('share-my-profile'));
    expect(share).toHaveBeenCalledWith({
      message: `Find me on TouchGrass 🌱 http://web.test/u/${ids.me}`,
    });
    await waitFor(() => {
      expect(screen.queryByTestId('open-referrals')).toBeNull();
    });
    expect(screen.getByTestId('open-challenges')).toBeOnTheScreen();
    share.mockRestore();
  });

  it('a plan becomes a 9:16 story card', async () => {
    mockRouteParams.current = { id: EVENT_ID };
    api.on('GET', `/v1/events/${EVENT_ID}`, { status: 200, body: eventDetail() });
    await renderWithProviders(<EventStoryScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('event-story-card')).toHaveTextContent(/Sunset run/);
    expect(screen.getByTestId('event-story-card')).not.toHaveTextContent(/KBR Park gate/);
    await fireEvent.press(screen.getByTestId('event-story-share'));
    const Sharing = jest.requireMock<{ shareAsync: jest.Mock }>('expo-sharing');
    await waitFor(() => {
      expect(Sharing.shareAsync).toHaveBeenCalled();
    });
  });

  it('shared profile and crew links open the right screen once signed in', async () => {
    mockRouteParams.current = { id: ids.other };
    await renderWithProviders(<ProfileLink />, { fetchFn: api.fetch });
    expect(screen.getByTestId('redirect')).toHaveTextContent(`/users/${ids.other}`);
    await renderWithProviders(<CrewLink />, { fetchFn: api.fetch });
    expect(screen.getAllByTestId('redirect').at(-1)).toHaveTextContent(`/crews/${ids.other}`);
    await act(async () => {
      await useAuthStore.getState().signOut();
    });
    await renderWithProviders(<ProfileLink />, { fetchFn: api.fetch });
    expect(screen.getAllByTestId('redirect').at(-1)).toHaveTextContent('/');
  });

  it('a newer version shows a dismissible banner; an unsupported one blocks the app', async () => {
    api.on('GET', '/v1/app/config', config({ latestVersion: '0.2.0' }));
    await renderWithProviders(<UpdatePrompt />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('update-available')).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('update-banner-open'));
    expect(openURL).toHaveBeenCalledWith(storeUrl());
    await fireEvent.press(screen.getByTestId('update-banner-later'));
    expect(screen.queryByTestId('update-available')).toBeNull();

    api.on(
      'GET',
      '/v1/app/config',
      config({ minSupportedVersion: '9.0.0', latestVersion: '9.0.0' }),
    );
    await renderWithProviders(<UpdatePrompt />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('update-required-gate')).toBeOnTheScreen();
    expect(storeUrl('android')).toBe(
      'https://play.google.com/store/apps/details?id=app.touchgrass',
    );
    expect(storeUrl('ios')).toBe('http://web.test');
  });

  it('only allow-listed, successful queries are kept for offline use', () => {
    const q = (queryKey: unknown[], status: 'success' | 'error' = 'success') =>
      ({ queryKey, state: { status } }) as never;
    expect(shouldPersist(q(['events', 'detail', 'x']))).toBe(true);
    expect(shouldPersist(q(['chat', 'inbox', 'all']))).toBe(true);
    expect(shouldPersist(q(['discover', 'feed', {}]))).toBe(true);
    expect(shouldPersist(q(['discover', 'search', 'biryani']))).toBe(false);
    expect(shouldPersist(q(['sessions']))).toBe(false);
    expect(shouldPersist(q(['events', 'detail', 'x'], 'error'))).toBe(false);
    expect(PERSIST_BUSTER).toMatch(/^p\d+-\d+$/);
  });

  it('analytics events are batched to the server', async () => {
    // Any screen that tracks binds the queue to the signed-in API client.
    await renderWithProviders(<UpdatePrompt />, { fetchFn: api.fetch });
    // Earlier tests left events queued; send those first so this batch is only ours.
    await act(async () => {
      await analytics.flush();
    });
    const before = api.callsTo('POST', '/v1/analytics/events').length;
    analytics.track('share_tapped', { target: 'event' });
    analytics.track('calendar_added', { target: 'device' });
    await act(async () => {
      await analytics.flush();
    });
    expect(api.callsTo('POST', '/v1/analytics/events')).toHaveLength(before + 1);
    const sent = api.callsTo('POST', '/v1/analytics/events').at(-1)?.body as {
      events: { name: string; properties: object }[];
    };
    expect(sent.events.map((e) => e.name)).toEqual(['share_tapped', 'calendar_added']);
    await analytics.flush();
  });
});
