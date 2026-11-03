import type { DeviceInfo } from '@touchgrass/shared';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { secureStorage } from './secure-storage';

const DEVICE_ID_KEY = 'tg.device.id';

/** Stable per-install id, so signing in again on this phone replaces its old session instead of piling up. */
export async function deviceInfo(appVersion: string): Promise<DeviceInfo> {
  let deviceId = await secureStorage.get(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = Crypto.randomUUID();
    await secureStorage.set(DEVICE_ID_KEY, deviceId);
  }
  const platform = Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web';
  return { deviceId, name: Device.modelName ?? Device.deviceName ?? 'Phone', platform, appVersion };
}
