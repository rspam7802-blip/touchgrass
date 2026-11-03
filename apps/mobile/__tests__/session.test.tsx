import { MeResponse } from '@touchgrass/shared';
import { landingRoute } from '../app/_layout';
import { createSessionClient } from '../src/lib/session-client';
import { appArea, useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi, meFixture } from '../test/fake-api';
import { resetStores } from '../test-utils';

beforeEach(() => {
  resetStores();
});

describe('auth store', () => {
  it('persists the session in SecureStore and hydrates it back', async () => {
    await useAuthStore.getState().signIn(authResponseFixture() as never);
    useAuthStore.setState({ status: 'loading', session: null });
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState()).toMatchObject({
      status: 'signedIn',
      session: { tokens: { accessToken: 'access-1' } },
    });
    await useAuthStore.getState().updateUser({ onboardingComplete: true });
    expect(useAuthStore.getState().session?.user.onboardingComplete).toBe(true);
    await useAuthStore.getState().signOut();
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe('signedOut');
  });

  it('treats corrupt stored sessions as signed out', async () => {
    const secure = jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store');
    secure.__store.set('tg.auth.session', '{nope');
    await useAuthStore.getState().hydrate();
    expect(useAuthStore.getState().status).toBe('signedOut');
  });

  it('maps auth state to app areas and landing routes', () => {
    const user = {
      id: 'u',
      status: 'onboarding' as const,
      onboardingComplete: false,
      tutorialComplete: false,
      roles: [],
    };
    expect(appArea('loading', null)).toBe('loading');
    expect(appArea('signedOut', null)).toBe('public');
    expect(appArea('signedIn', user)).toBe('onboarding');
    expect(appArea('signedIn', { ...user, onboardingComplete: true })).toBe('app');
    expect(landingRoute('loading', false)).toBeNull();
    expect(landingRoute('public', false)).toBe('/');
    expect(landingRoute('onboarding', false)).toBe('/start');
    expect(landingRoute('app', false)).toBe('/tutorial');
    expect(landingRoute('app', true)).toBe('/profile');
  });
});

describe('session client', () => {
  it('refreshes an expired access token once and retries, even for concurrent requests', async () => {
    await useAuthStore.getState().signIn(authResponseFixture() as never);
    let refreshes = 0;
    const api = new FakeApi()
      .on('GET', '/v1/me', (c) =>
        c.headers.authorization === 'Bearer access-2'
          ? { status: 200, body: meFixture() }
          : { status: 401, body: { error: { code: 'TOKEN_EXPIRED', message: 'x' } } },
      )
      .on('POST', '/v1/auth/refresh', () => {
        refreshes += 1;
        return {
          status: 200,
          body: {
            accessToken: 'access-2',
            refreshToken: 'refresh-2-xxxxxxxxxxxxxxxxxxxxxxxxx',
            accessTokenExpiresAt: '2026-10-31T00:30:00.000Z',
            sessionId: authResponseFixture().sessionId,
          },
        };
      });
    const client = createSessionClient('http://api.test', '0.1.0', api.fetch);
    const results = await Promise.all([
      client.request('/v1/me', MeResponse),
      client.request('/v1/me', MeResponse),
    ]);
    expect(results.map((r) => r.displayName)).toEqual(['Priya R.', 'Priya R.']);
    expect(refreshes).toBe(1);
    expect(useAuthStore.getState().session?.tokens.refreshToken).toBe(
      'refresh-2-xxxxxxxxxxxxxxxxxxxxxxxxx',
    );
  });

  it('signs out when the refresh token is rejected (e.g. reuse detected)', async () => {
    await useAuthStore.getState().signIn(authResponseFixture() as never);
    const api = new FakeApi()
      .on('GET', '/v1/me', {
        status: 401,
        body: { error: { code: 'TOKEN_EXPIRED', message: 'x' } },
      })
      .on('POST', '/v1/auth/refresh', {
        status: 401,
        body: { error: { code: 'SESSION_REVOKED', message: 'x' } },
      });
    const client = createSessionClient('http://api.test', '0.1.0', api.fetch);
    await expect(client.request('/v1/me', MeResponse)).rejects.toMatchObject({
      code: 'TOKEN_EXPIRED',
    });
    expect(useAuthStore.getState().status).toBe('signedOut');
  });

  it('does not refresh without a session', async () => {
    const api = new FakeApi().on('GET', '/v1/me', {
      status: 401,
      body: { error: { code: 'TOKEN_EXPIRED', message: 'x' } },
    });
    await expect(
      createSessionClient('http://api.test', '0.1.0', api.fetch).request('/v1/me', MeResponse),
    ).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(api.callsTo('POST', '/v1/auth/refresh')).toHaveLength(0);
  });
});
