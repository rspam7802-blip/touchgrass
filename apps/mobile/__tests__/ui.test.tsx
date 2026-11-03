import { StyleSheet } from 'react-native';
import NetInfo from '@react-native-community/netinfo';
import { fireEvent, screen } from '@testing-library/react-native';
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineBanner,
  OfflineState,
  Text,
} from '../components/ui';
import { renderWithProviders } from '../test-utils';

describe('Button', () => {
  it('exposes role, label and state, and meets the 44pt target', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button label="Pull up" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Pull up' });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
    // Filled buttons are taller than the minimum (D-151); every button meets the 44 pt target.
    const style = StyleSheet.flatten(button.props.style) as { minHeight: number; minWidth: number };
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(button).not.toBeDisabled();
  });
  it('is disabled and busy while loading', async () => {
    const onPress = jest.fn();
    await renderWithProviders(<Button label="Pay" loading onPress={onPress} variant="secondary" />);
    const button = screen.getByRole('button', { name: 'Pay' });
    expect(button).toBeDisabled();
    expect(button).toBeBusy();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
  it('renders ghost and danger variants', async () => {
    await renderWithProviders(
      <>
        <Button label="Skip" variant="ghost" />
        <Button label="Block" variant="danger" disabled />
      </>,
    );
    expect(screen.getByRole('button', { name: 'Block' })).toBeDisabled();
    expect(screen.getByText('Skip')).toBeOnTheScreen();
  });
});

describe('Text', () => {
  it('marks headings for screen readers and caps font scaling at 200%', async () => {
    await renderWithProviders(
      <>
        <Text variant="title">Plans</Text>
        <Text tone="danger">Oops</Text>
      </>,
    );
    expect(screen.getByRole('header', { name: 'Plans' })).toBeOnTheScreen();
    expect(screen.getByText('Oops').props.maxFontSizeMultiplier).toBe(2);
  });
});

describe('state views', () => {
  it('renders loading, empty, error and offline states with actions', async () => {
    const onRetry = jest.fn();
    const onAction = jest.fn();
    await renderWithProviders(
      <>
        <LoadingState />
        <EmptyState actionLabel="Plot a plan" onAction={onAction} />
        <ErrorState onRetry={onRetry} />
        <OfflineState onRetry={onRetry} />
      </>,
    );
    expect(screen.getByRole('progressbar', { name: 'Loading…' })).toBeOnTheScreen();
    expect(screen.getByText('Nothing here yet')).toBeOnTheScreen();
    expect(screen.getByText('That didn’t work')).toBeOnTheScreen();
    expect(screen.getByText("You're offline")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Plot a plan' }));
    for (const retry of screen.getAllByRole('button', { name: 'Try again' }))
      await fireEvent.press(retry);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });
  it('renders custom copy and hides actions without handlers', async () => {
    await renderWithProviders(
      <>
        <EmptyState title="No plans" body="Plot one" />
        <ErrorState message="Server sad" />
        <OfflineState />
        <LoadingState label="Fetching" />
      </>,
    );
    expect(screen.getByText('No plans')).toBeOnTheScreen();
    expect(screen.getByText('Server sad')).toBeOnTheScreen();
    expect(screen.getByText('Fetching')).toBeOnTheScreen();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('OfflineBanner', () => {
  it('appears only when the device is offline', async () => {
    await renderWithProviders(<OfflineBanner />);
    expect(screen.queryByText('Offline. Some things may be out of date.')).toBeNull();
    const online = NetInfo.useNetInfo();
    jest.mocked(NetInfo.useNetInfo).mockReturnValue({ ...online, isConnected: false });
    try {
      await renderWithProviders(<OfflineBanner />);
      expect(
        screen.getByRole('alert', { name: 'Offline. Some things may be out of date.' }),
      ).toBeOnTheScreen();
    } finally {
      jest.mocked(NetInfo.useNetInfo).mockReturnValue(online);
    }
  });
});
