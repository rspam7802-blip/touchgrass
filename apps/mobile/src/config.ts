import Constants from 'expo-constants';
import { z } from 'zod';

const Extra = z.object({
  apiUrl: z.url(),
  realtimeUrl: z.url(),
  webUrl: z.url(),
  appStoreUrl: z.url().optional(),
  playStoreUrl: z.url().optional(),
  sentryDsn: z.string().optional(),
  firebasePhoneAuth: z.boolean().default(false),
  eas: z.object({ projectId: z.string() }).optional(),
});

export type AppEnvironment = z.infer<typeof Extra> & { appVersion: string };

const LOOPBACK = new Set(['localhost', '127.0.0.1']);

/**
 * In development a phone (Expo Go or a dev build) can't reach `localhost` on the computer running the
 * stack. Metro reports the address the phone loaded the bundle from (`hostUri`, e.g. "192.168.1.20:8081"),
 * so loopback service URLs are pointed at that machine instead. Non-loopback URLs are left alone.
 */
export function pointLoopbackAt(url: string, hostUri: string | null | undefined): string {
  if (!hostUri) return url;
  const host = hostUri.split(':')[0];
  if (!host || LOOPBACK.has(host)) return url;
  const parsed = new URL(url);
  if (!LOOPBACK.has(parsed.hostname)) return url;
  parsed.hostname = host;
  return parsed.toString().replace(/\/$/, url.endsWith('/') ? '/' : '');
}

/** Build-time config from app.config.ts `extra`. Contains no secrets. */
export function readAppEnvironment(): AppEnvironment {
  const extra = Extra.parse(Constants.expoConfig?.extra ?? {});
  const hostUri = __DEV__ ? Constants.expoConfig?.hostUri : null;
  return {
    ...extra,
    apiUrl: pointLoopbackAt(extra.apiUrl, hostUri),
    realtimeUrl: pointLoopbackAt(extra.realtimeUrl, hostUri),
    webUrl: pointLoopbackAt(extra.webUrl, hostUri),
    appVersion: Constants.expoConfig?.version ?? '0.0.0',
  };
}
