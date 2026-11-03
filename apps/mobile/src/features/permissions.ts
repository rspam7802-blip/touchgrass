import * as Contacts from 'expo-contacts';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export const PERMISSION_CONSENT_VERSION = '2026-10';

export interface PushRegistration {
  granted: boolean;
  token: string | null;
}

/** Asks for notification permission and, when an EAS project is configured, fetches the Expo push token. */
export async function requestPushPermission(
  projectId: string | undefined,
): Promise<PushRegistration> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'TouchGrass',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  const { granted } = await Notifications.requestPermissionsAsync();
  if (!granted || !projectId) return { granted, token: null };
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  return { granted, token: token.data };
}

export async function requestContactsPermission(): Promise<boolean> {
  return (await Contacts.requestPermissionsAsync()).granted;
}

export async function requestLocationPermission(): Promise<boolean> {
  return (await Location.requestForegroundPermissionsAsync()).granted;
}
