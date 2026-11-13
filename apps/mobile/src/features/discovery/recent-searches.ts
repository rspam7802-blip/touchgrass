import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'search:recent';
export const MAX_RECENT_SEARCHES = 6;

/** The person's last few searches, newest first. Kept on the phone only. */
export async function readRecentSearches(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENT_SEARCHES)
      : [];
  } catch {
    return [];
  }
}

/** Remembers a search (moving a repeat to the front) and returns the new list. */
export async function rememberSearch(query: string): Promise<string[]> {
  const text = query.trim();
  const current = await readRecentSearches();
  if (text.length < 2) return current;
  const next = [text, ...current.filter((q) => q.toLowerCase() !== text.toLowerCase())].slice(
    0,
    MAX_RECENT_SEARCHES,
  );
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Suggestions are a convenience; search still works without them.
  }
  return next;
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
