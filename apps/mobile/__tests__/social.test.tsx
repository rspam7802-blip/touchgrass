import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { hashPhoneE164 } from '@touchgrass/shared';
import * as Contacts from 'expo-contacts';
import { Share } from 'react-native';
import SquadScreen from '../app/(app)/(tabs)/squad';
import ContactsScreen from '../app/(app)/contacts';
import ReportScreen from '../app/(app)/report';
import BlockedPeopleScreen from '../app/(app)/settings/blocked';
import PrivacySettingsScreen from '../app/(app)/settings/privacy';
import UserProfileScreen from '../app/(app)/users/[id]';
import { readHashedContacts } from '../src/features/social/contacts';
import { inviteUrl } from '../src/features/social/invite-link';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids, interestsFixture, urlsFixture } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const person = (id: string, displayName: string, mutualFriendCount = 0) => ({
  id,
  displayName,
  photo: null,
  verified: false,
  mutualFriendCount,
});
const friend = person(ids.other, 'Rohan K.', 2);
const stranger = person('0192f3a4-5b6c-7d8e-9f01-00000000aaaa', 'Sneha P.');

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
    .on('GET', /^\/v1\/social\/squad$/, {
      status: 200,
      body: { items: [friend], nextCursor: null },
    })
    .on('GET', '/v1/social/requests', {
      status: 200,
      body: {
        items: [{ person: stranger, direction: 'incoming', createdAt: '2026-10-31T00:00:00.000Z' }],
      },
    })
    .on('GET', '/v1/social/suggestions', {
      status: 200,
      body: {
        items: [
          {
            person: person('0192f3a4-5b6c-7d8e-9f01-00000000bbbb', 'Kavya N.', 3),
            reasons: ['mutual_friends', 'shared_interests'],
            sharedInterestCount: 2,
            score: 9,
          },
        ],
      },
    })
    .on('GET', '/v1/activity', {
      status: 200,
      body: {
        items: [
          {
            id: '0192f3a4-5b6c-7d8e-9f01-00000000cccc',
            verb: 'squad_joined',
            actor: friend,
            subject: stranger,
            object: null,
            createdAt: '2026-10-31T06:00:00.000Z',
          },
        ],
        nextCursor: null,
      },
    })
    .on('POST', '/v1/social/requests', { status: 200, body: { relationship: 'request_sent' } })
    .on('POST', /\/accept$/, { status: 200, body: { relationship: 'squad' } })
    .on('POST', /\/dismiss$/, { status: 204 });
});

describe('Squad tab (F-SOC-02..04)', () => {
  it('lists the squad and opens profiles', async () => {
    await renderWithProviders(<SquadScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Rohan K., 2 mutuals' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/users/[id]',
      params: { id: ids.other },
    });
    expect(screen.getByRole('tab', { name: 'Requests (1)' })).toBeOnTheScreen();
  });

  it('accepts incoming requests', async () => {
    await renderWithProviders(<SquadScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('tab', { name: 'Requests (1)' }));
    expect(await screen.findByText('Wants to join your squad')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(api.callsTo('POST', `/v1/social/requests/${stranger.id}/accept`)).toHaveLength(1),
    );
  });

  it('shows suggestion reasons, adds with an idempotency key and dismisses', async () => {
    await renderWithProviders(<SquadScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('tab', { name: 'People you might know' }));
    expect(await screen.findByText('Mutual friends · Shared interests')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Add to squad' }));
    await waitFor(() => expect(api.callsTo('POST', '/v1/social/requests')).toHaveLength(1));
    expect(api.callsTo('POST', '/v1/social/requests')[0]?.headers['idempotency-key']).toMatch(
      /^req-/,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(api.calls.some((c) => c.path.endsWith('/dismiss'))).toBe(true));
  });

  it('renders the activity feed in the chosen language', async () => {
    await renderWithProviders(<SquadScreen />, { fetchFn: api.fetch, language: 'hi' });
    await fireEvent.press(screen.getByRole('tab', { name: 'एक्टिविटी' }));
    expect(await screen.findByText(/Rohan K\. और Sneha P\. अब स्क्वॉड हैं/)).toBeOnTheScreen();
  });

  it('empty and error states', async () => {
    const empty = new FakeApi()
      .on('GET', /^\/v1\/social\/squad$/, { status: 200, body: { items: [], nextCursor: null } })
      .on('GET', '/v1/social/requests', { status: 200, body: { items: [] } })
      .on('GET', '/v1/social/suggestions', {
        status: 500,
        body: { error: { code: 'INTERNAL', message: 'x' } },
      })
      .on('GET', '/v1/activity', { status: 200, body: { items: [], nextCursor: null } });
    await renderWithProviders(<SquadScreen />, { fetchFn: empty.fetch });
    // Wait for the loaded empty state: the header shortcut with the same label unmounts once it shows.
    expect(await screen.findByText(/^No one in your squad yet/)).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Find friends from contacts' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/contacts');
    await fireEvent.press(screen.getByRole('tab', { name: 'People you might know' }));
    expect(await screen.findByTestId('state-error')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('tab', { name: 'Activity' }));
    expect(await screen.findByText(/Quiet for now/)).toBeOnTheScreen();
  });
});

describe('Contacts (F-SOC-01)', () => {
  it('hashes numbers on device, dedupes, and skips invalid ones', async () => {
    const read = await readHashedContacts();
    expect(read).toEqual({
      granted: true,
      contacts: [
        {
          name: 'Ananya (on TouchGrass)',
          e164: '+919848022338',
          hash: hashPhoneE164('+919848022338'),
        },
        { name: 'Rohan (not here)', e164: '+919999988888', hash: hashPhoneE164('+919999988888') },
      ],
    });
  });

  it('uploads only hashes, shows matches and invites the rest', async () => {
    const share = jest
      .spyOn(Share, 'share')
      .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
    api
      .on('POST', '/v1/social/contacts/match', {
        status: 200,
        body: {
          items: [
            {
              hash: hashPhoneE164('+919848022338'),
              person: person(ids.other, 'Ananya R.'),
              relationship: 'none',
            },
          ],
        },
      })
      .on('GET', '/v1/me/invites', {
        status: 200,
        body: { quota: 5, remaining: 4, items: [], shareUrlBase: 'https://tg.app/invite' },
      });
    await renderWithProviders(<ContactsScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Check my contacts' }));
    expect(await screen.findByText('Ananya R.')).toBeOnTheScreen();
    const body = api.callsTo('POST', '/v1/social/contacts/match')[0]?.body as { hashes: string[] };
    expect(body.hashes).toEqual([hashPhoneE164('+919848022338'), hashPhoneE164('+919999988888')]);
    expect(JSON.stringify(body)).not.toContain('98480');
    await fireEvent.press(screen.getByRole('button', { name: 'Rohan (not here), Invite' }));
    expect(share).toHaveBeenCalledWith({
      message: expect.stringContaining('http://web.test') as string,
      title: 'Rohan (not here)',
    });
  });

  it('explains when permission is denied', async () => {
    jest
      .mocked(Contacts.requestPermissionsAsync)
      .mockResolvedValueOnce({ granted: false } as never);
    await renderWithProviders(<ContactsScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Check my contacts' }));
    expect(
      await screen.findByText('Allow contacts access in Settings to find friends.'),
    ).toBeOnTheScreen();
  });

  it('builds invite links from an unused code', () => {
    const code = {
      id: ids.asset,
      code: 'ABCD-EFGH',
      maxUses: 1,
      uses: 0,
      expiresAt: null,
      revoked: false,
      label: null,
      createdAt: '2026-10-31T00:00:00.000Z',
    };
    expect(
      inviteUrl(
        { quota: 5, remaining: 4, items: [code], shareUrlBase: 'https://tg.app/invite' },
        'https://tg.app',
      ),
    ).toBe('https://tg.app/invite/ABCD-EFGH');
    expect(
      inviteUrl(
        {
          quota: 5,
          remaining: 4,
          items: [{ ...code, uses: 1 }],
          shareUrlBase: 'https://tg.app/invite',
        },
        'https://tg.app',
      ),
    ).toBe('https://tg.app');
    expect(inviteUrl(undefined, 'https://tg.app')).toBe('https://tg.app');
  });
});

describe('Profiles: squad actions, block and report (F-SOC-05)', () => {
  const profile = (relationship: string) => ({
    id: ids.other,
    displayName: 'Rohan K.',
    bio: '',
    age: 27,
    pronouns: null,
    neighbourhoodName: null,
    spokenLanguages: [],
    photos: [urlsFixture],
    interests: interestsFixture.slice(0, 1),
    vibeTags: [],
    sharedInterestIds: [],
    mutualFriends: { count: 2, sample: [] },
    stats: { eventsAttended: 0, eventsHosted: 0, reliabilityTier: 'new' },
    verified: false,
    limited: false,
    relationship,
    hostRating: null,
  });
  beforeEach(() => {
    mockRouteParams.current = { id: ids.other };
  });

  it.each([
    ['none', 'Add to squad'],
    ['request_sent', 'Cancel request'],
    ['request_received', 'Accept'],
    ['squad', 'Remove from squad'],
  ])('relationship %s shows "%s"', async (relationship, label) => {
    api.on('GET', `/v1/users/${ids.other}/profile`, { status: 200, body: profile(relationship) });
    await renderWithProviders(<UserProfileScreen />, { fetchFn: api.fetch });
    expect(await screen.findByRole('button', { name: label })).toBeOnTheScreen();
    expect(screen.getByText('2 mutual friends')).toBeOnTheScreen();
  });

  it('shows the host rating once there are enough ratings (F-AFT-02)', async () => {
    api.on('GET', `/v1/users/${ids.other}/profile`, {
      status: 200,
      body: { ...profile('none'), hostRating: { average: 4.6, count: 7 } },
    });
    await renderWithProviders(<UserProfileScreen />, { fetchFn: api.fetch });
    expect(await screen.findByTestId('host-rating')).toHaveTextContent('4.6/5 as host (7)');
  });

  it('hides the host rating while it is null', async () => {
    api.on('GET', `/v1/users/${ids.other}/profile`, { status: 200, body: profile('none') });
    await renderWithProviders(<UserProfileScreen />, { fetchFn: api.fetch });
    await screen.findByRole('button', { name: 'Add to squad' });
    expect(screen.queryByTestId('host-rating')).toBeNull();
  });

  it('blocks after confirmation and goes back', async () => {
    api
      .on('GET', `/v1/users/${ids.other}/profile`, { status: 200, body: profile('none') })
      .on('POST', '/v1/social/blocks', { status: 204 });
    await renderWithProviders(<UserProfileScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Block' }));
    expect(
      screen.getByText('Block Rohan K.? You will not see each other anywhere on TouchGrass.'),
    ).toBeOnTheScreen();
    await fireEvent.press(screen.getByTestId('confirm-block'));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(api.callsTo('POST', '/v1/social/blocks')[0]?.body).toEqual({ userId: ids.other });
  });

  it('opens the report screen for this person', async () => {
    api.on('GET', `/v1/users/${ids.other}/profile`, { status: 200, body: profile('none') });
    await renderWithProviders(<UserProfileScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Report profile' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/report',
      params: { targetType: 'user', targetId: ids.other, name: 'Rohan K.' },
    });
  });

  it('report screen needs a category, sends details and optional block', async () => {
    mockRouteParams.current = { targetType: 'user', targetId: ids.other, name: 'Rohan K.' };
    api.on('POST', '/v1/reports', { status: 201, body: { id: ids.asset, severity: 'high' } });
    await renderWithProviders(<ReportScreen />, { fetchFn: api.fetch });
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('radio', { name: 'Harassment or bullying' }));
    await fireEvent.changeText(screen.getByTestId('report-details'), 'Rude messages');
    await fireEvent(screen.getByTestId('report-also-block'), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText('Thanks. We are on it.')).toBeOnTheScreen();
    expect(api.callsTo('POST', '/v1/reports')[0]?.body).toEqual({
      targetType: 'user',
      targetId: ids.other,
      category: 'harassment',
      details: 'Rude messages',
      alsoBlock: true,
    });
    expect(api.callsTo('POST', '/v1/reports')[0]?.headers['idempotency-key']).toMatch(/^report-/);
  });
});

describe('Settings: blocked people and social privacy', () => {
  it('lists and unblocks', async () => {
    api
      .on('GET', '/v1/social/blocks', {
        status: 200,
        body: {
          items: [
            { id: ids.other, displayName: 'Rohan K.', blockedAt: '2026-10-31T00:00:00.000Z' },
          ],
        },
      })
      .on('DELETE', `/v1/social/blocks/${ids.other}`, { status: 204 });
    await renderWithProviders(<BlockedPeopleScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Unblock' }));
    await waitFor(() =>
      expect(api.callsTo('DELETE', `/v1/social/blocks/${ids.other}`)).toHaveLength(1),
    );
  });

  it('empty blocked list', async () => {
    api.on('GET', '/v1/social/blocks', { status: 200, body: { items: [] } });
    await renderWithProviders(<BlockedPeopleScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('You have not blocked anyone.')).toBeOnTheScreen();
  });

  it('toggles activity sharing and contact discovery', async () => {
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
    await fireEvent(await screen.findByTestId('toggle-share-activity'), 'valueChange', false);
    await fireEvent(screen.getByTestId('toggle-discoverable'), 'valueChange', false);
    await waitFor(() =>
      expect(api.callsTo('PUT', '/v1/me/settings/privacy').map((c) => c.body)).toEqual([
        { shareActivity: false },
        { discoverableByContacts: false },
      ]),
    );
  });
});
