import { useNetInfo } from '@react-native-community/netinfo';

/** True only when we positively know the device is offline (unknown → treat as online). */
export function useIsOffline(): boolean {
  const { isConnected } = useNetInfo();
  return isConnected === false;
}
