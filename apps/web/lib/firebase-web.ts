/**
 * Firebase phone sign-in for the admin console (D-167). With `SMS_PROVIDER=none` the API sends no codes, so
 * the console signs in like the app: Firebase texts and checks the code in the browser, and the API turns
 * the resulting proof into a session. These values are Firebase's public web config (Firebase console →
 * Project settings → Your apps → Web app), read per request so one build serves every deployment.
 */
export interface FirebaseWebConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
}

/** Null when the deployment has no Firebase web app: the console then uses the API's own codes. */
export function firebaseWebConfig(
  env: Record<string, string | undefined> = process.env,
): FirebaseWebConfig | null {
  const v = (key: string): string | null => {
    const value = env[key]?.trim();
    return value ? value : null;
  };
  const apiKey = v('FIREBASE_WEB_API_KEY');
  const projectId = v('FIREBASE_PROJECT_ID');
  if (!apiKey || !projectId) return null;
  return {
    apiKey,
    projectId,
    authDomain: v('FIREBASE_AUTH_DOMAIN') ?? `${projectId}.firebaseapp.com`,
  };
}

/** What a Firebase sign-in error means for the person signing in. */
export type FirebaseSignInProblem = 'codeWrong' | 'tooManyTries' | 'badPhone' | 'other';

export function firebaseProblem(err: unknown): FirebaseSignInProblem {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
  if (
    code === 'auth/invalid-verification-code' ||
    code === 'auth/code-expired' ||
    code === 'auth/session-expired'
  )
    return 'codeWrong';
  if (code === 'auth/too-many-requests' || code === 'auth/quota-exceeded') return 'tooManyTries';
  if (code === 'auth/invalid-phone-number') return 'badPhone';
  return 'other';
}

/** Firebase's short error code (e.g. `auth/billing-not-enabled`), shown next to the generic message so a
 * setup problem can be diagnosed without the browser console. Only well-formed codes are returned. */
export function firebaseErrorCode(err: unknown): string | null {
  const code = typeof err === 'object' && err !== null && 'code' in err ? String(err.code) : '';
  return /^auth\/[a-z0-9-]{1,60}$/.test(code) ? code : null;
}
