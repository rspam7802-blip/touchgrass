import AsyncStorage from '@react-native-async-storage/async-storage';
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '@touchgrass/shared';
import { create } from 'zustand';

const LANGUAGE_KEY = 'tg.settings.language';

interface SettingsState {
  language: SupportedLanguage | null;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setLanguage: (language: SupportedLanguage) => Promise<void>;
}

const isSupported = (value: string | null): value is SupportedLanguage =>
  value !== null && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);

/** Device-local preferences. Tokens live in SecureStore (auth store), never here. */
export const useSettingsStore = create<SettingsState>((set) => ({
  language: null,
  hydrated: false,
  hydrate: async () => {
    const stored = await AsyncStorage.getItem(LANGUAGE_KEY).catch(() => null);
    set({ language: isSupported(stored) ? stored : null, hydrated: true });
  },
  setLanguage: async (language) => {
    set({ language });
    await AsyncStorage.setItem(LANGUAGE_KEY, language);
  },
}));
