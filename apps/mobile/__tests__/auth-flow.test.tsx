import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import InviteScreen from '../app/(auth)/invite';
import OtpScreen from '../app/(auth)/otp';
import PhoneScreen from '../app/(auth)/phone';
import WelcomeScreen from '../app/index';
import { useAuthFlowStore } from '../src/stores/auth-flow-store';
import { useAuthStore } from '../src/stores/auth-store';
import { authResponseFixture, FakeApi } from '../test/fake-api';
import { mockRouteParams, mockRouter, renderWithProviders, resetStores } from '../test-utils';

let api: FakeApi;
beforeEach(() => {
  resetStores();
  mockRouteParams.current = {};
  api = new FakeApi().on('GET', '/v1/app/config', {
    status: 200,
    body: { minSupportedVersion: '0.1.0', latestVersion: '0.1.0', flags: { invite_gate: true } },
  });
});

describe('Welcome', () => {
  it('routes to phone sign-in or the invite screen once config loads', async () => {
    await renderWithProviders(<WelcomeScreen />, { fetchFn: api.fetch });
    await fireEvent.press(await screen.findByRole('button', { name: 'Get started' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/phone');
    await fireEvent.press(screen.getByRole('button', { name: 'I have an invite code' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/invite');
  });
});

describe('Invite screen (F-ACC-01)', () => {
  it('rejects malformed and unknown codes', async () => {
    api.on('POST', '/v1/auth/invites/check', {
      status: 200,
      body: { valid: false, inviterName: null },
    });
    await renderWithProviders(<InviteScreen />, { fetchFn: api.fetch });
    expect(screen.getByRole('button', { name: 'Check code' })).toBeDisabled();
    await fireEvent.changeText(screen.getByTestId('invite-input'), 'ab!!');
    await fireEvent.press(screen.getByRole('button', { name: 'Check code' }));
    expect(await screen.findByText("That invite code doesn't work.")).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('invite-input'), 'nope-nope');
    await fireEvent.press(screen.getByRole('button', { name: 'Check code' }));
    expect(await screen.findByText("That invite code doesn't work.")).toBeOnTheScreen();
    expect(api.callsTo('POST', '/v1/auth/invites/check')[0]?.body).toEqual({ code: 'NOPE-NOPE' });
  });

  it('stores a valid invite and continues to phone sign-in', async () => {
    api.on('POST', '/v1/auth/invites/check', {
      status: 200,
      body: { valid: true, inviterName: 'Ananya' },
    });
    await renderWithProviders(<InviteScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('invite-input'), 'grass-2026');
    await fireEvent.press(screen.getByRole('button', { name: 'Check code' }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/phone'));
    expect(useAuthFlowStore.getState()).toMatchObject({
      inviteCode: 'GRASS-2026',
      inviterName: 'Ananya',
    });
    expect(screen.getByText('Invite from Ananya ✓')).toBeOnTheScreen();
  });

  it('returns to the OTP screen when it was asked for mid-verification', async () => {
    mockRouteParams.current = { next: 'otp' };
    api.on('POST', '/v1/auth/invites/check', {
      status: 200,
      body: { valid: true, inviterName: null },
    });
    await renderWithProviders(<InviteScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('invite-input'), 'GRASS-2026');
    await fireEvent.press(screen.getByRole('button', { name: 'Check code' }));
    await waitFor(() => expect(mockRouter.back).toHaveBeenCalled());
    expect(screen.getByText('Invite code accepted ✓')).toBeOnTheScreen();
  });
});

describe('Phone screen (F-ACC-02)', () => {
  it('validates, normalises to E.164 and requests a code', async () => {
    api.on('POST', '/v1/auth/otp/request', {
      status: 200,
      body: { expiresAt: '2026-10-31T00:05:00.000Z', resendAfterSeconds: 30 },
    });
    await renderWithProviders(<PhoneScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('phone-input'), '00000 00000');
    await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
    expect(await screen.findByText('Enter a valid mobile number.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('phone-input'), '98480 22338');
    await fireEvent.press(screen.getByRole('button', { name: 'Send code' }));
    await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/otp'));
    expect(api.callsTo('POST', '/v1/auth/otp/request')[0]?.body).toEqual({
      phone: '+919848022338',
    });
    expect(useAuthFlowStore.getState().phone).toBe('+919848022338');
  });

  it('shows translated server errors (rate limit)', async () => {
    api.on('POST', '/v1/auth/otp/request', {
      status: 429,
      body: { error: { code: 'RATE_LIMITED', message: 'slow' } },
    });
    await renderWithProviders(<PhoneScreen />, { fetchFn: api.fetch, language: 'hi' });
    await fireEvent.changeText(screen.getByTestId('phone-input'), '9848022338');
    await fireEvent.press(screen.getByRole('button', { name: 'कोड भेजो' }));
    expect(await screen.findByText('ज़रा रुको, फिर कोशिश करो.')).toBeOnTheScreen();
  });
});

describe('OTP screen (F-ACC-02)', () => {
  beforeEach(() => {
    useAuthFlowStore.getState().setPhone('+919848022338');
  });

  it('verifies, stores the session securely and records consent for new users', async () => {
    useAuthFlowStore.getState().setInvite('GRASS-2026', null);
    api
      .on('POST', '/v1/auth/otp/verify', { status: 200, body: authResponseFixture() })
      .on('POST', '/v1/me/consents', { status: 204 });
    await renderWithProviders(<OtpScreen />, { fetchFn: api.fetch });
    expect(screen.getByText('Sent to +91••••••••38')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByTestId('otp-input'), '12a3456');
    await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(useAuthStore.getState().status).toBe('signedIn'));
    const verify = api.callsTo('POST', '/v1/auth/otp/verify')[0]?.body as {
      code: string;
      inviteCode: string;
      device: { deviceId: string; name: string };
    };
    expect(verify).toMatchObject({
      code: '123456',
      inviteCode: 'GRASS-2026',
      device: { name: 'Pixel 9' },
    });
    expect(
      api.callsTo('POST', '/v1/me/consents').map((c) => (c.body as { kind: string }).kind),
    ).toEqual(['terms', 'privacy', 'age_confirmation']);
    expect(api.callsTo('POST', '/v1/me/consents')[0]?.headers.authorization).toBe(
      'Bearer access-1',
    );
    const secure = jest.requireMock<{ __store: Map<string, string> }>('expo-secure-store');
    expect(secure.__store.get('tg.auth.session')).toContain('refresh-1');
    expect(useAuthFlowStore.getState().phone).toBeNull();
  });

  it('sends the user to enter an invite when the server requires one', async () => {
    api.on('POST', '/v1/auth/otp/verify', {
      status: 403,
      body: { error: { code: 'INVITE_REQUIRED', message: 'x' } },
    });
    await renderWithProviders(<OtpScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('otp-input'), '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() =>
      expect(mockRouter.push).toHaveBeenCalledWith({
        pathname: '/invite',
        params: { next: 'otp' },
      }),
    );
  });

  it('shows wrong-code errors and only allows resend after the cooldown', async () => {
    jest.useFakeTimers();
    api
      .on('POST', '/v1/auth/otp/verify', {
        status: 400,
        body: { error: { code: 'OTP_INVALID', message: 'x', details: { attemptsRemaining: 4 } } },
      })
      .on('POST', '/v1/auth/otp/request', {
        status: 200,
        body: { expiresAt: '2026-10-31T00:05:00.000Z', resendAfterSeconds: 30 },
      });
    await renderWithProviders(<OtpScreen />, { fetchFn: api.fetch });
    await fireEvent.changeText(screen.getByTestId('otp-input'), '000001');
    await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));
    expect(
      await screen.findByText("That code isn't right. Check and try again."),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('otp-resend')).toBeDisabled();
    for (let i = 0; i < 30; i += 1) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
      });
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Resend code' }));
    await waitFor(() => expect(api.callsTo('POST', '/v1/auth/otp/request')).toHaveLength(1));
    jest.useRealTimers();
  });

  it('without a number in progress it offers to change the number', async () => {
    useAuthFlowStore.getState().reset();
    await renderWithProviders(<OtpScreen />, { fetchFn: api.fetch });
    await fireEvent.press(screen.getByRole('button', { name: 'Change number' }));
    expect(mockRouter.replace).toHaveBeenCalledWith('/phone');
  });
});
