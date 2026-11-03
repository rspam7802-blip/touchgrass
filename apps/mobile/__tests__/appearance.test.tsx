import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, screen } from '@testing-library/react-native';
import * as ReactNative from 'react-native';
import AppearanceSettingsScreen from '../app/(app)/settings/appearance';
import { Text } from '../components/ui';
import { useSettingsStore } from '../src/stores/settings-store';
import { useTheme } from '../src/theme/theme';
import { renderWithProviders, resetStores } from '../test-utils';

function SchemeProbe() {
  const theme = useTheme();
  return <Text testID="scheme">{`${theme.scheme} ${theme.colors.background}`}</Text>;
}

describe('light and dark (D-153)', () => {
  let phone: 'light' | 'dark' = 'light';
  let spy: jest.SpyInstance | null = null;
  beforeEach(() => {
    resetStores();
    spy = jest.spyOn(ReactNative, 'useColorScheme').mockImplementation(() => phone);
  });
  afterEach(() => {
    spy?.mockRestore();
  });

  it('follows the phone by default', async () => {
    phone = 'light';
    const light = await renderWithProviders(<SchemeProbe />);
    expect(screen.getByTestId('scheme')).toHaveTextContent('light #F4F5F0');
    await light.unmount();
    phone = 'dark';
    await renderWithProviders(<SchemeProbe />);
    expect(screen.getByTestId('scheme')).toHaveTextContent('dark #0B130E');
  });

  it('an app choice overrides the phone and is saved on the device', async () => {
    phone = 'dark';
    await renderWithProviders(
      <>
        <AppearanceSettingsScreen />
        <SchemeProbe />
      </>,
    );
    expect(await screen.findByRole('radio', { name: 'Same as phone' })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: 'Light' }));
    expect(screen.getByTestId('scheme')).toHaveTextContent(/^light /);
    expect(await AsyncStorage.getItem('tg.settings.appearance')).toBe('light');
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().appearance).toBe('light');
    await fireEvent.press(screen.getByRole('radio', { name: 'Same as phone' }));
    expect(screen.getByTestId('scheme')).toHaveTextContent(/^dark /);
  });
});
