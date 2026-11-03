import type { ConfigContext, ExpoConfig } from 'expo/config';

const VERSION = '0.1.0';
/** Host serving share links and /.well-known association files (apps/web in production). */
const LINK_HOST = process.env.EXPO_PUBLIC_LINK_HOST ?? 'tg.app';
/** EAS profiles (eas.json) set APP_VARIANT so development and preview builds install beside the store app. */
const VARIANT = process.env.APP_VARIANT ?? 'production';
const SUFFIX = VARIANT === 'production' ? '' : `.${VARIANT}`;
/** expo-camera and expo-image-picker both write the iOS camera prompt; keep one text covering both uses. */
const CAMERA_PURPOSE =
  'TouchGrass uses the camera for your verification selfie and so hosts can scan check-in codes at the door.';
const NAME = VARIANT === 'production' ? 'TouchGrass' : `TouchGrass (${VARIANT})`;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: NAME,
  slug: 'touchgrass',
  scheme: 'touchgrass',
  version: VERSION,
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  ios: {
    bundleIdentifier: `app.touchgrass${SUFFIX}`,
    supportsTablet: false,
    associatedDomains: [`applinks:${LINK_HOST}`],
    config: {
      usesNonExemptEncryption: false,
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY,
    },
  },
  android: {
    package: `app.touchgrass${SUFFIX}`,
    // Tokens live in the Keystore, but cached screens and preferences must not ride along in cloud backups.
    allowBackup: false,
    // Pulled in by Expo modules but unused: no audio, no contact writes, media picked with the system picker.
    blockedPermissions: [
      'android.permission.RECORD_AUDIO',
      'android.permission.WRITE_CONTACTS',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
      'android.permission.SYSTEM_ALERT_WINDOW',
    ],
    config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY } },
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: ['/e/', '/u/', '/c/', '/claim/', '/invite/'].map((pathPrefix) => ({
          scheme: 'https',
          host: LINK_HOST,
          pathPrefix,
        })),
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    'expo-localization',
    // Tokens are not behind biometrics, so no Face ID prompt.
    ['expo-secure-store', { faceIDPermission: false }],
    ['expo-splash-screen', { backgroundColor: '#0B130E' }],
    [
      'expo-camera',
      {
        cameraPermission: CAMERA_PURPOSE,
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
    [
      'expo-contacts',
      {
        contactsPermission:
          'TouchGrass checks which of your contacts are already here so you can add them to your squad. Numbers are hashed on your phone before matching.',
      },
    ],
    [
      'expo-calendar',
      {
        calendarPermission:
          'TouchGrass adds plans you pull up to to your calendar and keeps them up to date.',
        remindersPermission: false,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'TouchGrass lets you choose photos for your profile and your Lore.',
        cameraPermission: CAMERA_PURPOSE,
        microphonePermission: false,
      },
    ],
    ['expo-notifications', { color: '#CCFF00' }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'TouchGrass uses your location to find plans nearby and to check you in when you arrive.',
        locationFullAccuracyPermission:
          'TouchGrass needs your precise location for a moment to check you in at the venue.',
        // Foreground only: no background location, no motion data.
        locationAlwaysAndWhenInUsePermission: false,
        locationAlwaysPermission: false,
        motionUsagePermission: false,
      },
    ],
  ],
  experiments: { typedRoutes: true },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000',
    realtimeUrl: process.env.EXPO_PUBLIC_REALTIME_URL ?? 'http://localhost:4001',
    webUrl: process.env.EXPO_PUBLIC_WEB_URL ?? 'http://localhost:3000',
    appStoreUrl: process.env.EXPO_PUBLIC_APP_STORE_URL,
    playStoreUrl: process.env.EXPO_PUBLIC_PLAY_STORE_URL,
    sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
    eas: process.env.EXPO_PUBLIC_EAS_PROJECT_ID
      ? { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID }
      : undefined,
  },
});
