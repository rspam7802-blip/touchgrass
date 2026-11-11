import type * as FirebaseAuth from '@react-native-firebase/auth';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { readAppEnvironment } from '../../config';

/**
 * Firebase phone sign-in (D-166). Firebase texts and checks the code; the app sends the resulting proof to
 * the API, which issues our own session. Only builds made with the Firebase config files include it, and
 * Expo Go never does, so there the app keeps using the server's codes.
 */
export function usesFirebasePhoneAuth(): boolean {
  return (
    readAppEnvironment().firebasePhoneAuth &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
  );
}

/** A Firebase sign-in problem the person can act on, with the API error code it corresponds to. */
export class FirebasePhoneError extends Error {
  constructor(
    public readonly appCode: 'OTP_INVALID' | 'OTP_EXPIRED' | 'RATE_LIMITED' | 'INVALID_PHONE',
  ) {
    super(appCode);
    this.name = 'FirebasePhoneError';
  }
}

let firebaseModule: typeof FirebaseAuth | null = null;

/** Loaded on first use only: Expo Go has no Firebase native code, and loading it there would crash. */
function firebaseAuth(): typeof FirebaseAuth {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- optional native module, loaded lazily
  firebaseModule ??= require('@react-native-firebase/auth') as typeof FirebaseAuth;
  return firebaseModule;
}

interface Confirmation {
  confirm(code: string): Promise<{ user: { getIdToken(): Promise<string> } } | null>;
}

let pending: { phone: string; confirmation: Confirmation } | null = null;
/** Kept after a successful code, so a retry (e.g. after adding an invite) needs no new SMS. */
let proven: { phone: string; token: string } | null = null;

function translate(err: unknown): unknown {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
  if (code === 'auth/invalid-verification-code') return new FirebasePhoneError('OTP_INVALID');
  if (code === 'auth/code-expired' || code === 'auth/session-expired')
    return new FirebasePhoneError('OTP_EXPIRED');
  if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded')
    return new FirebasePhoneError('RATE_LIMITED');
  if (code === 'auth/invalid-phone-number') return new FirebasePhoneError('INVALID_PHONE');
  return err;
}

/** Asks Firebase to text a code to `phone` (E.164). */
export async function sendFirebaseCode(phone: string): Promise<void> {
  const { getAuth, signInWithPhoneNumber } = firebaseAuth();
  try {
    pending = { phone, confirmation: await signInWithPhoneNumber(getAuth(), phone) };
    proven = null;
  } catch (err) {
    throw translate(err);
  }
}

/** Checks the code with Firebase and returns the proof (an ID token) for the API. */
export async function firebaseProof(phone: string, code: string): Promise<string> {
  if (proven?.phone === phone) return proven.token;
  if (pending?.phone !== phone) throw new FirebasePhoneError('OTP_EXPIRED');
  try {
    const credential = await pending.confirmation.confirm(code);
    if (!credential) throw new FirebasePhoneError('OTP_EXPIRED');
    proven = { phone, token: await credential.user.getIdToken() };
    return proven.token;
  } catch (err) {
    throw translate(err);
  }
}

/** Our own session is in place: drop the Firebase one, which was only needed to prove the number. */
export async function endFirebaseSignIn(): Promise<void> {
  pending = null;
  proven = null;
  const { getAuth, signOut } = firebaseAuth();
  await signOut(getAuth()).catch(() => undefined);
}
