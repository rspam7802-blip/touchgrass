import NetInfo from '@react-native-community/netinfo';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import WelcomeScreen from '../app/index';
import { useSettingsStore } from '../src/stores/settings-store';
import { jsonResponse, renderWithProviders } from '../test-utils';

const config =
  (min = '0.1.0') =>
  () =>
    Promise.resolve(
      jsonResponse(200, {
        minSupportedVersion: min,
        latestVersion: '0.2.0',
        flags: { invite_gate: true },
      }),
    );

beforeEach(() => {
  useSettingsStore.setState({ language: null, hydrated: true });
});

describe('WelcomeScreen', () => {
  it('shows the brand and loads startup config', async () => {
    await renderWithProviders(<WelcomeScreen />, { fetchFn: config() });
    expect(screen.getByText('Log off. Pull up.')).toBeOnTheScreen();
    expect(screen.getByTestId('state-loading')).toBeOnTheScreen();
    await waitFor(() => {
      expect(screen.queryByTestId('state-loading')).toBeNull();
    });
    expect(screen.queryByTestId('update-required')).toBeNull();
  });

  it('blocks with a forced update when below the minimum version', async () => {
    await renderWithProviders(<WelcomeScreen />, { fetchFn: config('9.0.0') });
    expect(await screen.findByTestId('update-required')).toBeOnTheScreen();
    expect(screen.getByText('Update TouchGrass to keep going.')).toBeOnTheScreen();
  });

  it('shows a translated error with retry for API errors', async () => {
    const fetchFn = jest
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(429, { error: { code: 'RATE_LIMITED', message: 'slow' } }),
      )
      .mockImplementation(config());
    await renderWithProviders(<WelcomeScreen />, { fetchFn });
    expect(await screen.findByText('Slow down a sec, then try again.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => {
      expect(screen.queryByTestId('state-error')).toBeNull();
    });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('shows a generic error for server failures', async () => {
    await renderWithProviders(<WelcomeScreen />, {
      fetchFn: () =>
        Promise.resolve(jsonResponse(500, { error: { code: 'INTERNAL', message: 'x' } })),
    });
    expect(
      await screen.findByText('Something went sideways. Give it another go.'),
    ).toBeOnTheScreen();
  });

  it('shows the offline state when the network is unreachable', async () => {
    await renderWithProviders(<WelcomeScreen />, {
      fetchFn: () => Promise.reject(new TypeError('Network request failed')),
    });
    expect(await screen.findByTestId('state-offline')).toBeOnTheScreen();
  });

  it('shows the offline banner when NetInfo reports no connection', async () => {
    const online = NetInfo.useNetInfo();
    jest.mocked(NetInfo.useNetInfo).mockReturnValue({ ...online, isConnected: false });
    try {
      await renderWithProviders(<WelcomeScreen />, {
        fetchFn: () => Promise.reject(new TypeError('offline')),
      });
      expect(screen.getByText('Offline. Some things may be out of date.')).toBeOnTheScreen();
      expect(await screen.findByTestId('state-offline')).toBeOnTheScreen();
    } finally {
      jest.mocked(NetInfo.useNetInfo).mockReturnValue(online);
    }
  });

  it('switches to Telugu and Hindi and persists the choice', async () => {
    await renderWithProviders(<WelcomeScreen />, { fetchFn: config() });
    await fireEvent.press(screen.getByRole('radio', { name: 'తెలుగు' }));
    expect(await screen.findByText('ఫోన్ పక్కన పెట్టు. బయటకు రా.')).toBeOnTheScreen();
    expect(useSettingsStore.getState().language).toBe('te');
    await fireEvent.press(screen.getByRole('radio', { name: 'हिन्दी' }));
    expect(await screen.findByText('फ़ोन छोड़ो. बाहर आओ.')).toBeOnTheScreen();
  });

  it('renders in dark mode', async () => {
    await renderWithProviders(<WelcomeScreen />, { fetchFn: config(), scheme: 'dark' });
    expect(screen.getByTestId('welcome-screen')).toHaveStyle({ backgroundColor: '#0B130E' });
  });
});
