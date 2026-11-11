import type { ConfirmationResult } from 'firebase/auth';
import type { FirebaseWebConfig } from '../../../lib/firebase-web';

/**
 * Browser half of the console's Firebase sign-in (D-167): Firebase checks the person is not a bot
 * (invisible reCAPTCHA), texts the code and checks it; we only keep its one-time proof. Loaded on demand,
 * so pages that don't sign in never download Firebase.
 */
export async function sendFirebaseCode(
  config: FirebaseWebConfig,
  phoneE164: string,
  containerId: string,
): Promise<ConfirmationResult> {
  const [{ getApps, initializeApp }, { getAuth, RecaptchaVerifier, signInWithPhoneNumber }] =
    await Promise.all([import('firebase/app'), import('firebase/auth')]);
  const app = getApps()[0] ?? initializeApp(config);
  const auth = getAuth(app);
  const verifier = new RecaptchaVerifier(auth, containerId, { size: 'invisible' });
  try {
    return await signInWithPhoneNumber(auth, phoneE164, verifier);
  } finally {
    verifier.clear();
  }
}

/** Checks the code with Firebase and returns the proof for the API; Firebase's own session is dropped. */
export async function firebaseProof(
  confirmation: ConfirmationResult,
  code: string,
): Promise<string> {
  const { user } = await confirmation.confirm(code);
  const token = await user.getIdToken();
  const { getAuth, signOut } = await import('firebase/auth');
  await signOut(getAuth());
  return token;
}
