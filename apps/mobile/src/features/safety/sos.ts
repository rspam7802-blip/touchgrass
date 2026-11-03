import { LIMITS, type LocationPointBody } from '@touchgrass/shared';
import * as Location from 'expo-location';
import type { TFunction } from 'i18next';
import * as Linking from 'expo-linking';
import { Alert } from 'react-native';

/** Where the phone is, if location is allowed; never asks or waits long in an emergency. */
export async function currentPoint(): Promise<LocationPointBody | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) return null;
    const pos =
      (await Location.getLastKnownPositionAsync()) ??
      (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
    return toPoint(pos.coords);
  } catch {
    return null;
  }
}

export function toPoint(coords: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}): LocationPointBody {
  const accuracy =
    typeof coords.accuracy === 'number'
      ? Math.min(Math.max(coords.accuracy, 0), LIMITS.safety.maxAccuracyMeters)
      : null;
  return { lat: coords.latitude, lng: coords.longitude, accuracy };
}

export function callEmergency(): void {
  void Linking.openURL(`tel:${LIMITS.safety.emergencyNumber}`);
}

/**
 * SOS (F-SAF-04): after one confirmation, alerts trusted contacts with the current location and opens the
 * dialler on 112. The call never waits for the network.
 */
export function confirmSos(t: TFunction, alert: (point: LocationPointBody | null) => void): void {
  Alert.alert(t('safety.sosTitle'), t('safety.sosBody'), [
    { text: t('common.cancel'), style: 'cancel' },
    {
      text: t('safety.sosConfirm'),
      style: 'destructive',
      onPress: () => {
        callEmergency();
        void currentPoint().then(alert);
      },
    },
  ]);
}
