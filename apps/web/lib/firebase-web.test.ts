import { describe, expect, it } from 'vitest';
import { firebaseProblem, firebaseWebConfig } from './firebase-web';

describe('firebaseWebConfig', () => {
  it('is off without an API key or project', () => {
    expect(firebaseWebConfig({})).toBeNull();
    expect(firebaseWebConfig({ FIREBASE_PROJECT_ID: 'tg-1' })).toBeNull();
    expect(firebaseWebConfig({ FIREBASE_WEB_API_KEY: 'key' })).toBeNull();
    expect(
      firebaseWebConfig({ FIREBASE_WEB_API_KEY: ' ', FIREBASE_PROJECT_ID: 'tg-1' }),
    ).toBeNull();
  });

  it('defaults the auth domain to the project', () => {
    expect(firebaseWebConfig({ FIREBASE_WEB_API_KEY: 'key', FIREBASE_PROJECT_ID: 'tg-1' })).toEqual(
      {
        apiKey: 'key',
        projectId: 'tg-1',
        authDomain: 'tg-1.firebaseapp.com',
      },
    );
    expect(
      firebaseWebConfig({
        FIREBASE_WEB_API_KEY: 'key',
        FIREBASE_PROJECT_ID: 'tg-1',
        FIREBASE_AUTH_DOMAIN: 'auth.example.com',
      })?.authDomain,
    ).toBe('auth.example.com');
  });
});

describe('firebaseProblem', () => {
  it('maps Firebase codes to what the person can do', () => {
    expect(firebaseProblem({ code: 'auth/invalid-verification-code' })).toBe('codeWrong');
    expect(firebaseProblem({ code: 'auth/code-expired' })).toBe('codeWrong');
    expect(firebaseProblem({ code: 'auth/too-many-requests' })).toBe('tooManyTries');
    expect(firebaseProblem({ code: 'auth/invalid-phone-number' })).toBe('badPhone');
    expect(firebaseProblem(new Error('network'))).toBe('other');
    expect(firebaseProblem(null)).toBe('other');
  });
});
