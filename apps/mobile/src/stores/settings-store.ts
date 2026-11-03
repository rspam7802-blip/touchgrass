import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@touchgrass/shared';
import { create } from 'zustand';

const LANGUAGE_KEY = 'tg.settings.language';
const APPEARANCE_KEY = 'tg.settings.appearance';

/** Light or dark: follow the phone (default), or pick one for this app. */
export type Appearance = 'system' | 'light' | 'dark';
const isAppearance = (value: string | null): value is Appearance =>
  value === 'system' || value === 'light' || value === 'dark';

interface SettingsState {
  language: SupportedLanguage | null;
  appearance: Appearance;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
  setAppearance: (appearance: Appearance) => Promise<void>;
}

const isSupported = (value: string | null): value is SupportedLanguage =>
  value !== null && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);

/** Device-local preferences. Tokens live in SecureStore (auth store), never here. */
export const useSettingsStore = create<SettingsState>((set) => ({
  language: null,
  appearance: 'system',
  hydrated: false,
  hydrate: async () => {
    const [stored, look] = await Promise.all([
      AsyncStorage.getItem(LANGUAGE_KEY).catch(() => null),
      AsyncStorage.getItem(APPEARANCE_KEY).catch(() => null),
    ]);
    set({
      language: isSupported(stored) ? stored : null,
      appearance: isAppearance(look) ? look : 'system',
      hydrated: true,
    });
  },
  setLanguage: async (language) => {
    set({ language });
    await AsyncStorage.setItem(LANGUAGE_KEY, language);
  },
  setAppearance: async (appearance) => {
    set({ appearance });
    await AsyncStorage.setItem(APPEARANCE_KEY, appearance);
  },
}));
