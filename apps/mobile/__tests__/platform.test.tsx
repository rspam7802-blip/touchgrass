import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from '../src/lib/api-client';
import { createQueryClient } from '../src/lib/query-client';
import { createI18n, detectDeviceLanguage } from '../src/i18n/i18n';
import { useSettingsStore } from '../src/stores/settings-store';
import { buildTheme } from '../src/theme/theme';
import { readAppEnvironment } from '../src/config';
import * as Localization from 'expo-localization';

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageCode: 'en' }]) }));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: '0.1.0',
      extra: {
        apiUrl: 'http://localhost:4000',
        realtimeUrl: 'http://localhost:4001',
        webUrl: 'http://localhost:3000',
      },
    },
  },
}));

const locale = (languageCode: string): Localization.Locale => {
  const [base] = Localization.getLocales();
  return { ...base, languageCode, languageTag: languageCode };
};

describe('i18n', () => {
  it('detects the first supported device language', () => {
    jest.mocked(Localization.getLocales).mockReturnValueOnce([locale('fr'), locale('te')]);
    expect(detectDeviceLanguage()).toBe('te');
    jest.mocked(Localization.getLocales).mockReturnValueOnce([locale('fr')]);
    expect(detectDeviceLanguage()).toBe('en');
  });
  it('creates isolated instances with fallbacks', () => {
    const hi = createI18n('hi');
    expect(hi.t('vocab.squad')).toBe('स्क्वॉड');
    expect(createI18n('en').t('vocab.squad')).toBe('Squad');
  });
});

describe('settings store', () => {
  it('persists and hydrates the language, ignoring junk', async () => {
    await useSettingsStore.getState().setLanguage('te');
    useSettingsStore.setState({ language: null, hydrated: false });
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState()).toMatchObject({ language: 'te', hydrated: true });
    await AsyncStorage.setItem('tg.settings.language', 'klingon');
    await useSettingsStore.getState().hydrate();
    expect(useSettingsStore.getState().language).toBeNull();
  });
});

describe('query client', () => {
  it('retries only retryable failures, at most three times', () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry as (
      n: number,
      e: unknown,
    ) => boolean;
    expect(retry(0, new ApiError('NETWORK', 'x', 0))).toBe(true);
    expect(retry(0, new ApiError('FORBIDDEN', 'x', 403))).toBe(false);
    expect(retry(3, new ApiError('NETWORK', 'x', 0))).toBe(false);
    expect(retry(0, new Error('unknown'))).toBe(true);
  });
});

describe('theme and config', () => {
  it('builds light and dark themes with the 44pt target', () => {
    expect(buildTheme('dark', true)).toMatchObject({
      scheme: 'dark',
      reduceMotion: true,
      minTouchTarget: 44,
    });
    expect(buildTheme('light', false).colors.primary).toBe('#3D5E0F');
    expect(buildTheme('dark', false).colors.primary).toBe('#E5FB46');
  });
  it('reads build-time config', () => {
    expect(readAppEnvironment()).toEqual({
      apiUrl: 'http://localhost:4000',
      realtimeUrl: 'http://localhost:4001',
      webUrl: 'http://localhost:3000',
      // Off unless the build has the Firebase config files (D-166).
      firebasePhoneAuth: false,
      appVersion: '0.1.0',
    });
  });
});
