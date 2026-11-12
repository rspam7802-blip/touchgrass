import { signInWithPhoneNumber } from '@react-native-firebase/auth';
import type { TFunction } from 'i18next';
import {
  CODE_REQUEST_TIMEOUT_MS,
  FirebasePhoneError,
  sendFirebaseCode,
} from '../src/features/auth/firebase-phone';
import { StorageUploadError } from '../src/features/media/upload';
import { errorMessage } from '../src/lib/errors';

const t = ((key: string, params?: { status?: number }) =>
  params?.status === undefined ? key : `${key}:${String(params.status)}`) as unknown as TFunction;

describe('errorMessage for storage uploads', () => {
  it('says storage could not be reached when no request got through', () => {
    expect(
      errorMessage(t, new StorageUploadError(0, { cause: new Error('host unreachable') })),
    ).toBe('states.uploadUnreachable');
  });

  it("shows storage's answer when it turned the upload down", () => {
    expect(errorMessage(t, new StorageUploadError(403))).toBe('states.uploadFailed:403');
  });
});

describe('Firebase code request', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('gives up with a clear message when Firebase never answers', async () => {
    jest.useFakeTimers();
    jest.mocked(signInWithPhoneNumber).mockReturnValueOnce(new Promise(() => undefined));
    const sent = sendFirebaseCode('+919100221712');
    jest.advanceTimersByTime(CODE_REQUEST_TIMEOUT_MS);
    const err: unknown = await sent.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FirebasePhoneError);
    expect(errorMessage(t, err)).toBe('auth.codeRequestTimeout');
  });

  it('still sends the code when Firebase answers in time', async () => {
    await expect(sendFirebaseCode('+919100221712')).resolves.toBeUndefined();
  });
});
