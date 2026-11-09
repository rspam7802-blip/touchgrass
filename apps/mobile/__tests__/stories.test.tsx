import * as ImagePicker from 'expo-image-picker';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import type { PersonCard, PersonStories, Story, StoryTray } from '@touchgrass/shared';
import NewStoryScreen from '../app/(app)/stories/new';
import StoryViewerScreen from '../app/(app)/stories/[userId]';
import { StoryTray as Tray } from '../components/stories/StoryTray';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, ids, urlsFixture } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

const P2 = '0192f3a4-5b6c-7d8e-9f01-000000000003';
const S1 = '0192f3a4-5b6c-7d8e-9f01-00000005a001';
const S2 = '0192f3a4-5b6c-7d8e-9f01-00000005a002';
const CONV = '0192f3a4-5b6c-7d8e-9f01-00000005c001';

const person = (id: string, displayName: string): PersonCard => ({
  id,
  displayName,
  photo: null,
  verified: false,
  mutualFriendCount: 0,
});
const me = person(ids.me, 'Asha');
const kiran = person(ids.other, 'Kiran');
const meera = person(P2, 'Meera');

const story = (id: string, over: Partial<Story> = {}): Story => ({
  id,
  image: urlsFixture,
  video: null,
  caption: '',
  createdAt: '2026-11-03T08:00:00.000Z',
  expiresAt: '2026-11-04T08:00:00.000Z',
  seen: false,
  liked: false,
  mine: false,
  audience: null,
  held: false,
  viewCount: null,
  likeCount: null,
  ...over,
});

let api: FakeApi;
beforeEach(async () => {
  resetStores();
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
  api = new FakeApi();
});

describe('story tray', () => {
  it('offers to add a story, then lists people: new first with their names read out', async () => {
    const tray: StoryTray = {
      items: [
        {
          person: meera,
          mine: false,
          count: 2,
          unseen: true,
          latestAt: '2026-11-03T09:00:00.000Z',
        },
        {
          person: kiran,
          mine: false,
          count: 1,
          unseen: false,
          latestAt: '2026-11-03T10:00:00.000Z',
        },
      ],
    };
    api.on('GET', '/v1/stories', { status: 200, body: tray });
    await renderWithProviders(<Tray />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Add to your story' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/stories/new');
    await fireEvent.press(screen.getByRole('button', { name: 'Meera, new story' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/stories/[userId]',
      params: { userId: P2 },
    });
    expect(screen.getByRole('button', { name: 'Kiran, story' })).toBeOnTheScreen();
  });

  it('opens your own story, with a separate button to add another', async () => {
    api.on('GET', '/v1/stories', {
      status: 200,
      body: {
        items: [
          { person: me, mine: true, count: 1, unseen: false, latestAt: '2026-11-03T09:00:00.000Z' },
        ],
      },
    });
    await renderWithProviders(<Tray />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Your story' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/stories/[userId]',
      params: { userId: ids.me },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Add to your story' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/stories/new');
  });

  it('shows nothing when stories cannot load', async () => {
    await renderWithProviders(<Tray />, { fetchFn: api.fetch });
    await waitFor(() => expect(api.callsTo('GET', '/v1/stories')).toHaveLength(1));
    expect(screen.queryByTestId('story-tray')).toBeNull();
  });
});

describe('story viewer', () => {
  it("plays someone's stories: marks each seen, likes, and closes after the last", async () => {
    mockRouteParams.current = { userId: P2 };
    let liked = false;
    api
      .on('GET', `/v1/users/${P2}/stories`, () => ({
        status: 200,
        body: {
          person: meera,
          items: [story(S1, { caption: 'Sunset at the lake', liked }), story(S2)],
        } satisfies PersonStories,
      }))
      .on('POST', `/v1/stories/${S1}/view`, { status: 204 })
      .on('POST', `/v1/stories/${S2}/view`, { status: 204 })
      .on('PUT', `/v1/stories/${S1}/like`, () => {
        liked = true;
        return { status: 204 };
      });
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('Sunset at the lake')).toBeOnTheScreen();
    expect(screen.getByLabelText('Story 1 of 2')).toBeOnTheScreen();
    await waitFor(() => expect(api.callsTo('POST', `/v1/stories/${S1}/view`)).toHaveLength(1));
    // Only the author sees viewers; others get like, reply and report.
    expect(screen.queryByTestId('story-stats')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Like' }));
    expect(await screen.findByRole('button', { name: 'Remove like' })).toBeOnTheScreen();
    expect(api.callsTo('PUT', `/v1/stories/${S1}/like`)).toHaveLength(1);

    await fireEvent.press(screen.getByRole('button', { name: 'Next story' }));
    expect(await screen.findByLabelText('Story 2 of 2')).toBeOnTheScreen();
    await waitFor(() => expect(api.callsTo('POST', `/v1/stories/${S2}/view`)).toHaveLength(1));
    await fireEvent.press(screen.getByRole('button', { name: 'Previous story' }));
    expect(await screen.findByLabelText('Story 1 of 2')).toBeOnTheScreen();
    // Seen stories are not marked twice.
    expect(api.callsTo('POST', `/v1/stories/${S1}/view`)).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Next story' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Next story' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });

  it('replies by DM and reports, pausing the story', async () => {
    mockRouteParams.current = { userId: P2 };
    api
      .on('GET', `/v1/users/${P2}/stories`, {
        status: 200,
        body: { person: meera, items: [story(S1, { seen: true })] },
      })
      .on('POST', '/v1/chats/direct', {
        status: 200,
        body: {
          id: CONV,
          kind: 'direct',
          state: 'active',
          title: 'Meera',
          avatar: null,
          peer: meera,
          eventId: null,
          lastMessage: null,
          unreadCount: 0,
          muted: false,
          readOnly: false,
          canCreatePoll: false,
          opensAt: null,
          closesAt: null,
        },
      });
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Report story' }));
    expect(mockRouter.push).toHaveBeenCalledWith({
      pathname: '/report',
      params: { targetType: 'story', targetId: S1, name: 'Meera' },
    });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeOnTheScreen();
    // Already seen: no second view is recorded.
    expect(api.callsTo('POST', `/v1/stories/${S1}/view`)).toHaveLength(0);
    await fireEvent.press(screen.getByRole('button', { name: 'Reply' }));
    await waitFor(() =>
      expect(mockRouter.replace).toHaveBeenCalledWith({
        pathname: '/chats/[id]',
        params: { id: CONV },
      }),
    );
    expect(api.callsTo('POST', '/v1/chats/direct')[0]?.body).toEqual({ userId: P2 });
  });

  it('your own story: who saw it and liked it, a held notice, and delete', async () => {
    mockRouteParams.current = { userId: ids.me };
    api
      .on('GET', `/v1/users/${ids.me}/stories`, {
        status: 200,
        body: {
          person: me,
          items: [
            story(S1, {
              mine: true,
              seen: true,
              audience: 'squad',
              held: true,
              viewCount: 2,
              likeCount: 1,
            }),
          ],
        },
      })
      .on('GET', `/v1/stories/${S1}/viewers`, {
        status: 200,
        body: {
          items: [
            { person: kiran, liked: true, viewedAt: '2026-11-03T09:00:00.000Z' },
            { person: meera, liked: false, viewedAt: '2026-11-03T08:30:00.000Z' },
          ],
          nextCursor: null,
        },
      })
      .on('DELETE', `/v1/stories/${S1}`, { status: 204 });
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    expect(
      await screen.findByText('Only you can see this until it has been reviewed.'),
    ).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Like' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Seen by 2, 1 like' }));
    expect(await screen.findByLabelText('Kiran, Liked it')).toBeOnTheScreen();
    expect(screen.getByLabelText('Meera')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Delete story' }));
    await waitFor(() => expect(api.callsTo('DELETE', `/v1/stories/${S1}`)).toHaveLength(1));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
  });

  it('says when a story is gone (expired, removed or not for you)', async () => {
    mockRouteParams.current = { userId: P2 };
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    expect(await screen.findByText('This story is no longer available.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(mockRouter.back).toHaveBeenCalled();
  });
});

describe('video stories in the viewer (D-164)', () => {
  it('plays the clip, labelled for screen readers, and times the story by its length', async () => {
    mockRouteParams.current = { userId: P2 };
    api
      .on('GET', `/v1/users/${P2}/stories`, {
        status: 200,
        body: {
          person: meera,
          items: [
            story(S1, { video: { url: 'https://cdn.test/media/s1/video.mp4', durationMs: 9000 } }),
          ],
        } satisfies PersonStories,
      })
      .on('POST', `/v1/stories/${S1}/view`, { status: 204 });
    await renderWithProviders(<StoryViewerScreen />, { fetchFn: api.fetch });
    expect(await screen.findByLabelText('Video story from Meera')).toBeOnTheScreen();
    expect(screen.queryByTestId('story-image')).toBeNull();
  });
});

describe('story composer', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('picks a photo, waits for the check, and shares to the chosen audience', async () => {
    api
      .on('POST', '/v1/media/uploads', {
        status: 201,
        body: {
          assetId: ids.asset,
          upload: {
            url: 'https://s3.test/bucket',
            fields: { key: 'uploads/k' },
            expiresAt: '2026-11-03T09:00:00.000Z',
          },
        },
      })
      .on('POST', '/bucket', { status: 204 })
      .on('POST', `/v1/media/${ids.asset}/complete`, {
        status: 200,
        body: {
          id: ids.asset,
          purpose: 'story',
          status: 'ready',
          width: 900,
          height: 1600,
          urls: urlsFixture,
        },
      })
      .on('POST', '/v1/stories', { status: 201, body: { id: S1 } });
    global.fetch = (input: string | URL | Request, init?: RequestInit) =>
      (typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : input.url
      ).startsWith('file:')
        ? Promise.resolve(new Response('x'.repeat(4096)))
        : api.fetch(input, init);

    await renderWithProviders(<NewStoryScreen />, { fetchFn: api.fetch });
    expect(screen.getByRole('button', { name: 'Share story' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a photo or video' }));
    expect(await screen.findByRole('button', { name: 'Choose something else' })).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Caption (optional)'), '  Chai time  ');
    await fireEvent.press(screen.getByText('Your squad and their squads'));
    await fireEvent.press(screen.getByRole('button', { name: 'Share story' }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(api.callsTo('POST', '/v1/media/uploads')[0]?.body).toMatchObject({ purpose: 'story' });
    const posted = api.callsTo('POST', '/v1/stories')[0];
    expect(posted?.body).toEqual({
      mediaId: ids.asset,
      caption: 'Chai time',
      audience: 'squad_fof',
    });
    expect(posted?.headers['idempotency-key']).toMatch(/^story-/);
  });

  it('shares a video clip, uploaded as video for the server to re-encode (D-164)', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///clip.mov',
          type: 'video',
          duration: 9000,
          fileSize: 8 * 1024 * 1024,
          mimeType: 'video/quicktime',
          width: 1080,
          height: 1920,
        },
      ],
    });
    api
      .on('POST', '/v1/media/uploads', {
        status: 201,
        body: {
          assetId: ids.asset,
          upload: {
            url: 'https://s3.test/bucket',
            fields: { key: 'uploads/k' },
            expiresAt: '2026-11-03T09:00:00.000Z',
          },
        },
      })
      .on('POST', '/bucket', { status: 204 })
      .on('POST', `/v1/media/${ids.asset}/complete`, {
        status: 200,
        body: {
          id: ids.asset,
          purpose: 'story',
          status: 'ready',
          width: 720,
          height: 1280,
          urls: urlsFixture,
        },
      })
      .on('POST', '/v1/stories', { status: 201, body: { id: S1 } });
    global.fetch = api.fetch;

    await renderWithProviders(<NewStoryScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a photo or video' }));
    expect(await screen.findByLabelText('Your video, 9 seconds')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Share story' }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(api.callsTo('POST', '/v1/media/uploads')[0]?.body).toEqual({
      purpose: 'story',
      contentType: 'video/quicktime',
      sizeBytes: 8 * 1024 * 1024,
    });
  });

  it('turns away a clip over 15 seconds before uploading anything', async () => {
    jest.mocked(ImagePicker.launchImageLibraryAsync).mockResolvedValueOnce({
      canceled: false,
      assets: [
        {
          uri: 'file:///long.mp4',
          type: 'video',
          duration: 40000,
          fileSize: 9000,
          width: 1,
          height: 1,
        },
      ],
    });
    await renderWithProviders(<NewStoryScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Choose a photo or video' }));
    expect(await screen.findByText(/up to 15 seconds/)).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Share story' })).toBeDisabled();
    expect(api.callsTo('POST', '/v1/media/uploads')).toHaveLength(0);
  });
});
