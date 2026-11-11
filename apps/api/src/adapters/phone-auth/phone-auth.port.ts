import { AppError } from '../../common/errors/app-error.js';

/** A phone number proven by an identity provider (D-166). */
export interface VerifiedPhone {
  phoneE164: string;
  /** Stable id of this proof, used to accept each one only once. */
  proofId: string;
  /** When the person entered the SMS code. */
  authTime: Date;
  /** When the proof stops being valid. */
  expiresAt: Date;
}

export const invalidPhoneProof = (detail: string): AppError =>
  new AppError('UNAUTHENTICATED', 'Phone verification is not valid', { reason: detail });

/**
 * Verifies a sign-in proof from a phone identity provider (Firebase Authentication): the provider texts
 * the code itself, so no SMS sender registration is needed for sign-in.
 */
export abstract class PhoneIdentityVerifier {
  abstract verify(token: string, now?: Date): Promise<VerifiedPhone>;
}

/** `PHONE_AUTH_PROVIDER=none`: only the app's own SMS codes sign people in. */
export class NoPhoneIdentityVerifier extends PhoneIdentityVerifier {
  verify(_token: string): Promise<VerifiedPhone> {
    return Promise.reject(new AppError('FEATURE_DISABLED', 'This sign-in method is not enabled'));
  }
}
