declare module '@react-native-community/netinfo/jest/netinfo-mock' {
  import type NetInfo from '@react-native-community/netinfo';

  const mock: typeof NetInfo;
  export default mock;
}
