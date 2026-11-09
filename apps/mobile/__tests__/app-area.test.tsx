import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import * as Sharing from 'expo-sharing';
import { Alert, type AlertButton, Share } from 'react-native';
import MyProfileScreen from '../app/(app)/(tabs)/profile';
import SettingsScreen from '../app/(app)/(tabs)/settings';
import InvitesScreen from '../app/(app)/invites';
import ProfileEditScreen from '../app/(app)/profile-edit';
import AccountSettingsScreen from '../app/(app)/settings/account';
import LanguageSettingsScreen from '../app/(app)/settings/language';
import NotificationSettingsScreen from '../app/(app)/settings/notifications';
import PrivacySettingsScreen from '../app/(app)/settings/privacy';
import SessionsScreen from '../app/(app)/settings/sessions';
import TutorialScreen from '../app/(app)/tutorial';
import UserProfileScreen from '../app/(app)/users/[id]';
import { useAuthStore } from '../src/stores/auth-store';
import {
  authResponseFixture,
  FakeApi,
  ids,
  interestsFixture,
  meFixture,
  urlsFixture,
  vibesFixture,
} from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

let api: FakeApi;
beforeEach(async () => {
  resetStores();
  await useAuthStore.getState().signIn(
    authResponseFixture({
      user: {
        id: ids.me,
        status: 'active',
        onboardingComplete: true,
        tutorialComplete: false,
        roles: [],
      },
    }) as never,
  );
  api = new FakeApi()
    .on('GET', '/v1/me', { status: 200, body: meFixture() })
    .on('GET', '/v1/interests', { status: 200, body: { items: interestsFixture } })
    .on('GET', '/v1/vibe-tags', { status: 200, body: { items: vibesFixture } })
    .on('POST', '/v1/me/tutorial/complete', { status: 204 })
    .on('DELETE', '/v1/me/tutorial', { status: 204 });
});

describe('Tutorial (F-ACC-04)', () => {
  it('walks four cards then marks the tutorial complete', async () => {
    await renderWithProviders(<TutorialScreen />, { fetchFn: api.fetch });
    for (const card of ['pullUp', 'plot', 'squad']) {
      expect(screen.getByTestId(`tutorial-card-${card}`)).toBeOnTheScreen();
      await fireEvent.press(screen.getByRole('button', { name: 'Next' }));
    }
    expect(screen.getByTestId('tutorial-card-safety')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Skip tutorial' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/discover'));
    expect(api.callsTo('POST', '/v1/me/tutorial/complete')).toHaveLength(1);
    expect(useAuthStore.getState().session?.user.tutorialComplete).toBe(true);
  });

  it('can be skipped', async () => {
    await renderWithProviders(<TutorialScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Skip tutorial' }));
    await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/discover'));
  });
});

describe('My profile (F-ACC-05)', () => {
  it('shows profile, stats tier and navigation to edit and invites', async () => {
    await renderWithProviders(<MyProfileScreen />, { fetchFn: api.fetch });
    expect(await screen.findByRole('header', { name: 'Priya R.' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Reliability: New here')).toBeOnTheScreen();
    expect(screen.getByText('Interest 0')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Edit profile' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/profile-edit');
    await fireEvent.press(screen.getByRole('button', { name: 'Invite friends' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/invites');
    // Settings and share sit beside Edit; the rest is a grid of tiles (D-159).
    await fireEvent.press(screen.getByTestId('open-settings'));
    expect(mockRouter.push).toHaveBeenCalledWith('/settings');
    await fireEvent.press(screen.getByTestId('open-hosting'));
    expect(mockRouter.push).toHaveBeenCalledWith('/hosting');
    expect(screen.getByTestId('open-safety')).toBeOnTheScreen();
  });

  it('error state with retry', async () => {
    const failing = new FakeApi().on('GET', '/v1/me', {
      status: 500,
      body: { error: { code: 'INTERNAL', message: 'x' } },
    });
    await renderWithProviders(<MyProfileScreen />, { fetchFn: failing.fetch });
    expect(await screen.findByTestId('state-error')).toBeOnTheScreen();
  });
});

describe('Edit profile', () => {
  it('saves text fields and changed interests', async () => {
    api
      .on('PATCH', '/v1/me/profile', { status: 200, body: meFixture() })
      .on('PUT', '/v1/me/interests', {
        status: 200,
        body: { items: interestsFixture.slice(0, 4) },
      });
    await renderWithProviders(<ProfileEditScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(await screen.findByTestId('edit-bio'), 'Biryani over everything');
    await fireEvent.changeText(screen.getByTestId('edit-languages'), 'English, Telugu, Hindi,');
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Interest 3' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Done')).toBeOnTheScreen());
    expect(api.callsTo('PATCH', '/v1/me/profile')[0]?.body).toEqual({
      displayName: 'Priya R.',
      bio: 'Biryani over everything',
      pronouns: 'she/her',
      spokenLanguages: ['English', 'Telugu', 'Hindi'],
    });
    expect(api.callsTo('PUT', '/v1/me/interests')[0]?.body).toEqual({
      interestIds: [...ids.interests.slice(0, 3), ids.interests[3]],
    });
  });

  it('blocks invalid names and keeps the last photo', async () => {
    await renderWithProviders(<ProfileEditScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(await screen.findByTestId('edit-name'), 'P');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Some details need fixing.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove photo 1' }));
    expect(api.callsTo('PUT', '/v1/me/photos')).toHaveLength(0);
  });
});

describe('Invites (F-ACC-01)', () => {
  it('creates a code with an idempotency key and opens the share sheet', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    const code = {
      id: ids.asset,
      code: 'ABCD-EFGH',
      maxUses: 1,
      uses: 0,
      expiresAt: '2099-01-01T00:00:00.000Z',
      revoked: false,
      label: null,
      createdAt: '2026-10-31T00:00:00.000Z',
    };
    let items: unknown[] = [];
    api
      .on('GET', '/v1/me/invites', () => ({
        status: 200,
        body: {
          quota: 5,
          remaining: 5 - items.length,
          items,
          shareUrlBase: 'https://tg.app/invite',
        },
      }))
      .on('POST', '/v1/me/invites', () => {
        items = [code];
        return { status: 201, body: code };
      });
    await renderWithProviders(<InvitesScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('5 invites left')).toBeOnTheScreen();
    expect(screen.getByText('No invites yet. Bring your people.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Create invite' }));
    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        message: expect.stringContaining('ABCD-EFGH: https://tg.app/invite/ABCD-EFGH') as string,
      }),
    );
    expect(api.callsTo('POST', '/v1/me/invites')[0]?.headers['idempotency-key']).toMatch(
      /^invite-/,
    );
    expect(await screen.findByText('Used 0 of 1')).toBeOnTheScreen();
  });

  it('disables creation when the quota is used up', async () => {
    api.on('GET', '/v1/me/invites', {
      status: 200,
      body: { quota: 1, remaining: 0, items: [], shareUrlBase: 'https://tg.app/invite' },
    });
    await renderWithProviders(<InvitesScreen />, { fetchFn: api.fetch });
    expect(await screen.findByRole('button', { name: 'Create invite' })).toBeDisabled();
  });
});

describe('Other profiles (privacy-filtered)', () => {
  const profile = (o: Record<string, unknown> = {}) => ({
    id: ids.other,
    displayName: 'Rohan K.',
    bio: 'Cyclist',
    age: 27,
    pronouns: null,
    neighbourhoodName: 'Madhapur',
    spokenLanguages: [],
    photos: [urlsFixture],
    interests: interestsFixture.slice(0, 2),
    vibeTags: [],
    sharedInterestIds: [ids.interests[0]],
    mutualFriends: { count: 0, sample: [] },
    stats: { eventsAttended: 3, eventsHosted: 1, reliabilityTier: 'reliable' },
    verified: true,
    limited: false,
    relationship: 'none',
    hostRating: null,
    ...o,
  });
  beforeEach(() => {
    mockRouteParams.current = { id: ids.other };
  });

  it('shows age, area, shared interests and verification', async () => {
    api.on('GET', `/v1/users/${ids.other}/profile`, { status: 200, body: profile() });
    await renderWithProviders(<UserProfileScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('27 · Madhapur')).toBeOnTheScreen();
    expect(screen.getByText('1 shared interests')).toBeOnTheScreen();
    expect(screen.getByLabelText('Verified')).toBeOnTheScreen();
  });

  it('limited and hidden profiles', async () => {
    api.on('GET', `/v1/users/${ids.other}/profile`, {
      status: 200,
      body: profile({
        limited: true,
        bio: '',
        age: null,
        neighbourhoodName: null,
        interests: [],
        sharedInterestIds: [],
      }),
    });
    await renderWithProviders(<UserProfileScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('This profile is private.')).toBeOnTheScreen();
    const hidden = new FakeApi();
    await renderWithProviders(<UserProfileScreen />, { fetchFn: hidden.fetch });
    expect(await screen.findByText("We couldn't find that.")).toBeOnTheScreen();
  });
});

describe('Settings (F-ACC-07)', () => {
  it('navigates to each section, replays the tutorial and logs out', async () => {
    api.on('POST', '/v1/auth/logout', { status: 204 });
    await renderWithProviders(<SettingsScreen />, { fetchFn: api.fetch });
    for (const [row, path] of [
      ['row-notifications', '/settings/notifications'],
      ['row-privacy', '/settings/privacy'],
      ['row-language', '/settings/language'],
      ['row-sessions', '/settings/sessions'],
      ['row-account', '/settings/account'],
    ] as const) {
      await fireEvent.press(screen.getByTestId(row));
      expect(mockRouter.push).toHaveBeenLastCalledWith(path);
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Replay tutorial' }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenLastCalledWith('/tutorial'));
    expect(api.callsTo('DELETE', '/v1/me/tutorial')).toHaveLength(1);
    // The legal pages open on the website.
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await fireEvent.press(screen.getByTestId('row-terms'));
    expect(openURL).toHaveBeenLastCalledWith(expect.stringMatching(/\/terms$/));
    await fireEvent.press(screen.getByTestId('row-contact'));
    expect(openURL).toHaveBeenLastCalledWith(expect.stringMatching(/\/contact$/));
    openURL.mockRestore();
    // Logging out asks first.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await fireEvent.press(screen.getByRole('button', { name: 'Log out' }));
    expect(useAuthStore.getState().status).toBe('signedIn');
    const buttons: AlertButton[] = alertSpy.mock.calls.at(-1)?.[2] ?? [];
    await act(async () => {
      buttons.find((b) => b.text === 'Log out')?.onPress?.();
      await Promise.resolve();
    });
    alertSpy.mockRestore();
    await waitFor(() => expect(useAuthStore.getState().status).toBe('signedOut'));
    expect(screen.getByText('Version 0.1.0')).toBeOnTheScreen();
  });

  it('notification preferences toggle per category; safety is locked on', async () => {
    const items = [
      { category: 'squad', push: true, inApp: true },
      { category: 'safety', push: true, inApp: true },
    ];
    api
      .on('GET', '/v1/me/settings/notifications', { status: 200, body: { items } })
      .on('PUT', '/v1/me/settings/notifications', (c) => ({
        status: 200,
        body: { items: [{ category: 'squad', push: false, inApp: true }, items[1]], echo: c.body },
      }));
    await renderWithProviders(<NotificationSettingsScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('push-safety')).toBeDisabled();
    await fireEvent(screen.getByTestId('push-squad'), 'valueChange', false);
    await waitFor(() =>
      expect(api.callsTo('PUT', '/v1/me/settings/notifications')[0]?.body).toEqual({
        items: [{ category: 'squad', push: false, inApp: true }],
      }),
    );
  });

  it('privacy: visibility and toggles', async () => {
    const privacy = {
      profileVisibility: 'everyone',
      showFirstTimerBadge: true,
      readReceipts: true,
      showInWhoIsGoing: true,
      shareActivity: true,
      discoverableByContacts: true,
    };
    api
      .on('GET', '/v1/me/settings/privacy', { status: 200, body: privacy })
      .on('PUT', '/v1/me/settings/privacy', (c) => ({
        status: 200,
        body: { ...privacy, ...(c.body as object) },
      }));
    await renderWithProviders(<PrivacySettingsScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('radio', { name: 'Squad only' }));
    await waitFor(() =>
      expect(api.callsTo('PUT', '/v1/me/settings/privacy')[0]?.body).toEqual({
        profileVisibility: 'squad_only',
      }),
    );
    await fireEvent(screen.getByTestId('toggle-read-receipts'), 'valueChange', false);
    await waitFor(() =>
      expect(api.callsTo('PUT', '/v1/me/settings/privacy')[1]?.body).toEqual({
        readReceipts: false,
      }),
    );
  });

  it('language: switching saves the account language', async () => {
    api.on('PUT', '/v1/me/settings/language', { status: 204 });
    await renderWithProviders(<LanguageSettingsScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('radio', { name: 'తెలుగు' }));
    await waitFor(() =>
      expect(api.callsTo('PUT', '/v1/me/settings/language')[0]?.body).toEqual({ language: 'te' }),
    );
    expect(await screen.findByText('యాప్ భాష')).toBeOnTheScreen();
  });

  it('sessions: lists devices and revokes others', async () => {
    api
      .on('GET', '/v1/me/sessions', {
        status: 200,
        body: {
          items: [
            {
              id: ids.session,
              deviceName: 'Pixel 9',
              platform: 'android',
              appVersion: '0.1.0',
              createdAt: '2026-10-30T00:00:00.000Z',
              lastUsedAt: '2026-10-31T00:00:00.000Z',
              current: true,
            },
            {
              id: ids.otherSession,
              deviceName: 'iPhone',
              platform: 'ios',
              appVersion: '0.1.0',
              createdAt: '2026-10-29T00:00:00.000Z',
              lastUsedAt: '2026-10-30T00:00:00.000Z',
              current: false,
            },
          ],
        },
      })
      .on('DELETE', `/v1/me/sessions/${ids.otherSession}`, { status: 204 });
    await renderWithProviders(<SessionsScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Pixel 9 · This device')).toBeOnTheScreen();
    expect(screen.getAllByRole('button', { name: 'Log out device' })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Log out device' }));
    await waitFor(() =>
      expect(api.callsTo('DELETE', `/v1/me/sessions/${ids.otherSession}`)).toHaveLength(1),
    );
  });

  it('account: exports data via the share sheet and deletes only after typing DELETE', async () => {
    api
      .on('GET', '/v1/me/export', { status: 200, body: { format: 'touchgrass-export-v1' } })
      .on('POST', '/v1/me/deletion', {
        status: 202,
        body: { purgeAfter: '2026-11-14T00:00:00.000Z' },
      });
    await renderWithProviders(<AccountSettingsScreen />, { fetchFn: api.fetch });
    expect(screen.getByText(/permanently deleted after 14 days/)).toBeOnTheScreen();
    await fireEvent.press(
      screen.getAllByRole('button', { name: 'Download my data' })[0] ??
        screen.getByTestId('export-data'),
    );
    expect(await screen.findByText('Your data is ready to share.')).toBeOnTheScreen();
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      expect.stringMatching(/touchgrass-export-\d{4}-\d{2}-\d{2}\.json$/),
      expect.objectContaining({ mimeType: 'application/json' }),
    );
    expect(screen.getByRole('button', { name: 'Delete my account' })).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('delete-confirm'), 'DELETE');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    await waitFor(() => expect(useAuthStore.getState().status).toBe('signedOut'));
    expect(api.callsTo('POST', '/v1/me/deletion')[0]?.body).toEqual({ confirm: 'DELETE' });
  });
});
