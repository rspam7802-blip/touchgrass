import Constants from 'expo-constants';
import { z } from 'zod';

const Extra = z.object({
  apiUrl: z.url(),
  realtimeUrl: z.url(),
  webUrl: z.url(),
  appStoreUrl: z.url().optional(),
  playStoreUrl: z.url().optional(),
  sentryDsn: z.string().optional(),
  eas: z.object({ projectId: z.string() }).optional(),
});

export type AppEnvironment = z.infer<typeof Extra> & { appVersion: string };

/** Build-time config from app.config.ts `extra`. Contains no secrets. */
export function readAppEnvironment(): AppEnvironment {
  const extra = Extra.parse(Constants.expoConfig?.extra ?? {});
  return { ...extra, appVersion: Constants.expoConfig?.version ?? '0.0.0' };
}
