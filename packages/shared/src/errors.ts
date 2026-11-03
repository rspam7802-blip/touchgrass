import { z } from 'zod';

/** Stable, documented error codes. Never rename a code once shipped; add new ones instead. */
export const ErrorCode = z.enum([
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'TOKEN_EXPIRED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'IDEMPOTENCY_KEY_REUSED',
  'IDEMPOTENCY_KEY_REQUIRED',
  'INVALID_CURSOR',
  'PAYLOAD_TOO_LARGE',
  'UNSUPPORTED_MEDIA_TYPE',
  'APP_UPDATE_REQUIRED',
  'FEATURE_DISABLED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'OTP_TOO_MANY_ATTEMPTS',
  'INVITE_REQUIRED',
  'INVITE_INVALID',
  'INVITE_QUOTA_EXHAUSTED',
  'AGE_RESTRICTED',
  'ACCOUNT_SUSPENDED',
  'SESSION_REVOKED',
  'ONBOARDING_INCOMPLETE',
  'MEDIA_NOT_READY',
  'EVENT_FULL',
  'EVENT_CLOSED',
  'NOT_ELIGIBLE',
  'VERIFICATION_REQUIRED',
  'OFFER_EXPIRED',
  'CHECK_IN_UNAVAILABLE',
  'CHAT_UNAVAILABLE',
  'MESSAGE_REQUEST_PENDING',
  'WEBHOOK_SIGNATURE_INVALID',
  'HOLD_EXPIRED',
  'PERK_UNAVAILABLE',
  'PAYMENT_PROVIDER_ERROR',
  'NOT_FREE_NOW',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_CURSOR: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_KEY_REUSED: 422,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  APP_UPDATE_REQUIRED: 426,
  RATE_LIMITED: 429,
  FEATURE_DISABLED: 403,
  DEPENDENCY_UNAVAILABLE: 503,
  INTERNAL: 500,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  OTP_TOO_MANY_ATTEMPTS: 429,
  INVITE_REQUIRED: 403,
  INVITE_INVALID: 400,
  INVITE_QUOTA_EXHAUSTED: 409,
  AGE_RESTRICTED: 403,
  ACCOUNT_SUSPENDED: 403,
  SESSION_REVOKED: 401,
  ONBOARDING_INCOMPLETE: 409,
  MEDIA_NOT_READY: 409,
  EVENT_FULL: 409,
  EVENT_CLOSED: 409,
  NOT_ELIGIBLE: 403,
  VERIFICATION_REQUIRED: 403,
  OFFER_EXPIRED: 409,
  CHECK_IN_UNAVAILABLE: 409,
  CHAT_UNAVAILABLE: 409,
  MESSAGE_REQUEST_PENDING: 409,
  WEBHOOK_SIGNATURE_INVALID: 401,
  HOLD_EXPIRED: 409,
  PERK_UNAVAILABLE: 409,
  PAYMENT_PROVIDER_ERROR: 502,
  NOT_FREE_NOW: 409,
};

export const ErrorEnvelope = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelope>;

export function errorEnvelope(code: ErrorCode, message: string, details?: unknown): ErrorEnvelope {
  return details === undefined
    ? { error: { code, message } }
    : { error: { code, message, details } };
}

export function isErrorEnvelope(value: unknown): value is ErrorEnvelope {
  return ErrorEnvelope.safeParse(value).success;
}
