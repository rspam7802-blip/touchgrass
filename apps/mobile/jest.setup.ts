import mockAsyncStorage from '@react-native-async-storage/async-storage/jest/async-storage-mock';
import mockNetInfo from '@react-native-community/netinfo/jest/netinfo-mock';

jest.mock('@react-native-async-storage/async-storage', () => mockAsyncStorage);
jest.mock('@react-native-community/netinfo', () => mockNetInfo);
// Native inset measurement does not run under Jest; the library's mock provides fixed metrics.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual<{ default: object }>('react-native-safe-area-context/jest/mock').default,
);
jest.mock(
  'expo-router',
  () => jest.requireActual<{ expoRouterMock: object }>('./test/router-mock').expoRouterMock,
);

jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    getItemAsync: jest.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
    setItemAsync: jest.fn((k: string, v: string) => {
      store.set(k, v);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((k: string) => {
      store.delete(k);
      return Promise.resolve();
    }),
    __store: store,
  };
});
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => '11111111-2222-4333-8444-555555555555'),
}));
jest.mock('expo-device', () => ({ modelName: 'Pixel 9', deviceName: 'Pixel' }));
jest.mock('expo-notifications', () => ({
  AndroidImportance: { DEFAULT: 3 },
  setNotificationChannelAsync: jest.fn(() => Promise.resolve()),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ data: 'ExponentPushToken[test-token]' })),
  useLastNotificationResponse: jest.fn(() => null),
}));
// Sockets never connect under Jest: tests drive server pushes through `test/socket-mock` instead.
jest.mock(
  'socket.io-client',
  () => jest.requireActual<{ socketMock: object }>('./test/socket-mock').socketMock,
);
jest.mock('expo-contacts', () => ({
  ContactField: { FULL_NAME: 'fullName', PHONES: 'phones' },
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  Contact: {
    getAllDetails: jest.fn(() =>
      Promise.resolve([
        {
          fullName: 'Ananya (on TouchGrass)',
          phones: [{ number: '98480 22338' }, { number: '+91 98480 22338' }],
        },
        { fullName: 'Rohan (not here)', phones: [{ number: '099999 88888' }] },
        { fullName: 'Landline', phones: [{ number: '123' }] },
      ]),
    ),
  },
}));
jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  getForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  getLastKnownPositionAsync: jest.fn(() => Promise.resolve(null)),
  watchPositionAsync: jest.fn(() => Promise.resolve({ remove: jest.fn() })),
  getCurrentPositionAsync: jest.fn(() =>
    Promise.resolve({ coords: { latitude: 17.4436, longitude: 78.3519 } }),
  ),
}));
// Native views have no Jest renderer: stand-ins keep props (testID, onPress) inspectable.
jest.mock('react-native-maps', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Stub = (props: object) =>
    jest.requireActual<typeof import('react')>('react').createElement(View, props);
  return { __esModule: true, default: Stub, Marker: Stub, Circle: Stub };
});
jest.mock('react-native-svg', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const Stub = (props: object) =>
    jest.requireActual<typeof import('react')>('react').createElement(View, props);
  // Every SVG element (the QR code's shapes, SvgXml for the icon set) renders as a View.
  const shapes = ['Path', 'Rect', 'Circle', 'Ellipse', 'Line', 'Polyline', 'Polygon', 'G', 'Defs'];
  return {
    __esModule: true,
    default: Stub,
    Svg: Stub,
    SvgXml: Stub,
    ...Object.fromEntries(shapes.map((name) => [name, Stub])),
  };
});
jest.mock('expo-camera', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const permission = { granted: false, canAskAgain: true };
  const request = jest.fn(() => {
    permission.granted = true;
    return Promise.resolve(permission);
  });
  return {
    CameraView: (props: object) =>
      jest
        .requireActual<typeof import('react')>('react')
        .createElement(View, { ...props, testID: 'camera' }),
    useCameraPermissions: () => [permission, request],
  };
});
jest.mock('expo-image-picker', () => ({
  CameraType: { front: 'front', back: 'back' },
  requestCameraPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  launchCameraAsync: jest.fn(() =>
    Promise.resolve({ canceled: false, assets: [{ uri: 'file:///selfie.jpg' }] }),
  ),
  requestMediaLibraryPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  launchImageLibraryAsync: jest.fn(() =>
    Promise.resolve({ canceled: false, assets: [{ uri: 'file:///picked.heic' }] }),
  ),
}));
jest.mock('expo-video', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    useVideoPlayer: jest.fn((_source: unknown, setup?: (p: object) => void) => {
      const player = { play: jest.fn(), pause: jest.fn(), loop: false, muted: false };
      setup?.(player);
      return player;
    }),
    VideoView: (props: object) => createElement(View, { ...props, testID: 'video-view' }),
  };
});
jest.mock('expo-sms', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  sendSMSAsync: jest.fn(() => Promise.resolve({ result: 'sent' })),
}));
// Firebase phone sign-in (D-166): a confirmation whose code is always 123456.
jest.mock('@react-native-firebase/auth', () => ({
  getAuth: jest.fn(() => ({})),
  signOut: jest.fn(() => Promise.resolve()),
  signInWithPhoneNumber: jest.fn((_auth: unknown, phone: string) =>
    Promise.resolve({
      confirm: (code: string) =>
        code === '123456'
          ? Promise.resolve({
              user: { getIdToken: () => Promise.resolve(`firebase-proof-for-${phone}`) },
            })
          : Promise.reject(
              Object.assign(new Error('bad code'), { code: 'auth/invalid-verification-code' }),
            ),
    }),
  ),
}));
jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: jest.fn(() => ({
      resize: jest.fn().mockReturnThis(),
      renderAsync: jest.fn(() =>
        Promise.resolve({
          saveAsync: jest.fn(() =>
            Promise.resolve({ uri: 'file:///compressed.jpg', width: 2048, height: 2560 }),
          ),
        }),
      ),
    })),
  },
}));
// The native uploader (presigned POST to storage) replayed through the test's fetch, so tests still see
// the multipart POST to the storage URL and can make it fail.
jest.mock('expo-file-system/legacy', () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  uploadAsync: jest.fn(
    async (
      url: string,
      fileUri: string,
      options: { fieldName?: string; mimeType?: string; parameters?: Record<string, string> },
    ) => {
      const form = new FormData();
      for (const [k, v] of Object.entries(options.parameters ?? {})) form.append(k, v);
      form.append(options.fieldName ?? 'file', {
        uri: fileUri,
        type: options.mimeType,
      } as unknown as Blob);
      const res = await fetch(url, { method: 'POST', body: form });
      return { status: res.status, headers: {}, body: '' };
    },
  ),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(() => Promise.resolve(true)),
  shareAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-file-system', () => {
  const File = Object.assign(
    jest.fn().mockImplementation((dir: string, name: string) => ({
      uri: `${dir}/${name}`,
      write: jest.fn(() => Promise.resolve()),
    })),
    {
      // Resolves to the destination file, as the native module does once the download lands.
      downloadFileAsync: jest.fn((_url: string, destination: { uri: string }) =>
        Promise.resolve(destination),
      ),
    },
  );
  return { Paths: { cache: 'file:///cache' }, File };
});
jest.mock('expo-constants', () => ({
  __esModule: true,
  ExecutionEnvironment: { Bare: 'bare', Standalone: 'standalone', StoreClient: 'storeClient' },
  default: {
    expoConfig: {
      version: '0.1.0',
      extra: {
        apiUrl: 'http://api.test',
        realtimeUrl: 'http://rt.test',
        webUrl: 'http://web.test',
        eas: { projectId: 'eas-test' },
      },
    },
  },
}));

// Capturing a view to an image needs the native renderer; tests check what gets shared.
jest.mock('react-native-view-shot', () => ({
  captureRef: jest.fn(() => Promise.resolve('file:///cache/recap.png')),
}));
jest.mock('expo-calendar/legacy', () => ({
  EntityTypes: { EVENT: 'event' },
  Availability: { BUSY: 'busy', FREE: 'free', TENTATIVE: 'tentative' },
  requestCalendarPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getCalendarPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  getCalendarsAsync: jest.fn(() =>
    Promise.resolve([
      { id: 'cal-readonly', allowsModifications: false, isPrimary: false },
      { id: 'cal-primary', allowsModifications: true, isPrimary: true },
    ]),
  ),
  createEventAsync: jest.fn(() => Promise.resolve('device-event-1')),
  updateEventAsync: jest.fn(() => Promise.resolve('device-event-1')),
  deleteEventAsync: jest.fn(() => Promise.resolve()),
}));
