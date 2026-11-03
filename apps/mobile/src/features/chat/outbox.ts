import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const KEY = 'tg.chat.outbox';

/** A message written while offline or still in flight; resent with the same clientId until the API has it. */
export interface PendingMessage {
  clientId: string;
  conversationId: string;
  kind: 'text' | 'image';
  body?: string;
  mediaId?: string;
  replyToId?: string;
  createdAt: string;
  status: 'sending' | 'failed';
}

interface OutboxState {
  items: PendingMessage[];
  hydrated: boolean;
  hydrate: () => Promise<void>;
  enqueue: (m: Omit<PendingMessage, 'status' | 'createdAt'>) => PendingMessage;
  setStatus: (clientId: string, status: PendingMessage['status']) => void;
  remove: (clientId: string) => void;
}

const persist = (items: PendingMessage[]): void => {
  AsyncStorage.setItem(KEY, JSON.stringify(items)).catch(() => undefined);
};

/** The offline queue (F-CHT-04). Survives restarts; the API de-duplicates by clientId. */
export const useOutbox = create<OutboxState>((set, get) => ({
  items: [],
  hydrated: false,
  hydrate: async () => {
    const raw = await AsyncStorage.getItem(KEY).catch(() => null);
    let items: PendingMessage[] = [];
    if (raw) {
      try {
        // Anything that was mid-flight when the app closed is retried as "failed" (tap or reconnect resends).
        items = (JSON.parse(raw) as PendingMessage[]).map((m) => ({
          ...m,
          status: 'failed' as const,
        }));
      } catch {
        items = [];
      }
    }
    set({ items, hydrated: true });
  },
  enqueue: (m) => {
    const item: PendingMessage = { ...m, createdAt: new Date().toISOString(), status: 'sending' };
    const items = [...get().items, item];
    set({ items });
    persist(items);
    return item;
  },
  setStatus: (clientId, status) => {
    const items = get().items.map((m) => (m.clientId === clientId ? { ...m, status } : m));
    set({ items });
    persist(items);
  },
  remove: (clientId) => {
    const items = get().items.filter((m) => m.clientId !== clientId);
    set({ items });
    persist(items);
  },
}));

/** Unguessable, URL-safe client id. */
export function newClientId(random: () => string): string {
  return `m${random().replace(/-/g, '')}`;
}
