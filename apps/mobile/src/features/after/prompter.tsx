import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { usePendingPostEvent } from './api';

/** Plans already offered this session, so "Later" means later (next launch), not on every foreground. */
const offered = new Set<string>();

/** Test hook: forget what this session already offered. */
export function resetOfferedPostEvents(): void {
  offered.clear();
}

/**
 * Post-event prompt (F-AFT-01): when the app opens or comes back to the foreground, asks the API for the
 * newest plan the person checked in to and has not wrapped up yet, and opens its "How was it?" screen once.
 */
export function AfterEventPrompter() {
  const router = useRouter();
  const q = usePendingPostEvent(true);
  const refetch = useRef(q.refetch);
  refetch.current = q.refetch;

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refetch.current();
    });
    return () => {
      sub.remove();
    };
  }, []);

  const card = q.data?.card ?? null;
  useEffect(() => {
    if (!card || offered.has(card.event.id)) return;
    offered.add(card.event.id);
    router.push({ pathname: '/after/[id]', params: { id: card.event.id } });
  }, [card, router]);

  return null;
}
