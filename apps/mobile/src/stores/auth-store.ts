import type { AuthResponse, AuthTokens, SessionUser } from '@touchgrass/shared';
import { create } from 'zustand';
import { secureStorage } from '../lib/secure-storage';

const SESSION_KEY = 'tg.auth.session';

export interface StoredSession {
  tokens: AuthTokens;
  user: SessionUser;
}

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn';
  session: StoredSession | null;
  hydrate: () => Promise<void>;
  signIn: (res: AuthResponse) => Promise<void>;
  setTokens: (tokens: AuthTokens) => Promise<void>;
  updateUser: (patch: Partial<SessionUser>) => Promise<void>;
  signOut: () => Promise<void>;
}

/** Session state. Tokens persist in SecureStore; the rest of the app reads them from here. */
export const useAuthStore = create<AuthState>((set, get) => {
  const persist = async (session: StoredSession | null): Promise<void> => {
    if (session) await secureStorage.set(SESSION_KEY, JSON.stringify(session));
    else await secureStorage.remove(SESSION_KEY);
  };
  return {
    status: 'loading',
    session: null,
    hydrate: async () => {
      const raw = await secureStorage.get(SESSION_KEY).catch(() => null);
      let session: StoredSession | null = null;
      if (raw) {
        try {
          session = JSON.parse(raw) as StoredSession;
        } catch {
          session = null;
        }
      }
      set({ session, status: session ? 'signedIn' : 'signedOut' });
    },
    signIn: async (res) => {
      const session: StoredSession = {
        tokens: {
          accessToken: res.accessToken,
          refreshToken: res.refreshToken,
          accessTokenExpiresAt: res.accessTokenExpiresAt,
          sessionId: res.sessionId,
        },
        user: res.user,
      };
      set({ session, status: 'signedIn' });
      await persist(session);
    },
    setTokens: async (tokens) => {
      const current = get().session;
      if (!current) return;
      const session = { ...current, tokens };
      set({ session });
      await persist(session);
    },
    updateUser: async (patch) => {
      const current = get().session;
      if (!current) return;
      const session = { ...current, user: { ...current.user, ...patch } };
      set({ session });
      await persist(session);
    },
    signOut: async () => {
      set({ session: null, status: 'signedOut' });
      await persist(null);
    },
  };
});

/** Which part of the app the user belongs in (drives the Stack.Protected guards). */
export type AppArea = 'loading' | 'public' | 'onboarding' | 'app';

export function appArea(
  status: AuthState['status'],
  user: SessionUser | null | undefined,
): AppArea {
  if (status === 'loading') return 'loading';
  if (status === 'signedOut' || !user) return 'public';
  return user.onboardingComplete ? 'app' : 'onboarding';
}
