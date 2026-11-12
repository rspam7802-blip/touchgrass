import type { TFunction } from 'i18next';
import {
  PhotoAccessDeniedError,
  StorageUploadError,
  VideoTooLargeError,
  VideoTooLongError,
} from '../features/media/upload';
import { FirebasePhoneError } from '../features/auth/firebase-phone';
import { ApiError } from './api-client';

/** Translated copy for a stable reason code, with the dates some reasons carry (e.g. a cooldown's end). */
export function reasonText(
  t: TFunction,
  reason: string,
  params: { until?: string | null; fallback?: string } = {},
): string {
  const until = params.until ? new Date(params.until) : undefined;
  // Rendered by the `istDate` formatter registered in src/i18n.
  return t(`events.reasons.${reason}`, { defaultValue: params.fallback, until });
}

/** Maps any thrown error to translated, user-facing copy (stable error codes → i18n keys). */
export function errorMessage(t: TFunction, err: unknown): string | null {
  if (!err) return null;
  if (err instanceof PhotoAccessDeniedError) return t('states.photoAccessDenied');
  if (err instanceof StorageUploadError)
    return err.status === 0
      ? t('states.uploadUnreachable')
      : t('states.uploadFailed', { status: err.status });
  if (err instanceof VideoTooLongError) return t('stories.videoTooLong');
  if (err instanceof VideoTooLargeError) return t('stories.videoTooLarge');
  if (err instanceof FirebasePhoneError)
    return err.appCode === 'INVALID_PHONE' ? t('auth.invalidPhone') : t(`errors.${err.appCode}`);
  if (err instanceof ApiError) {
    if (err.code === 'NETWORK') return t('states.offlineBody');
    const reason = reasonOf(err.details);
    // Event rules explain themselves more precisely than the generic code (e.g. "you need to be at the spot").
    if (reason)
      return reasonText(t, reason, {
        until: untilOf(err.details),
        fallback: t(`errors.${err.code}`),
      });
    return t(`errors.${err.code}`);
  }
  return t('states.errorBody');
}

function reasonOf(details: unknown): string | null {
  if (typeof details !== 'object' || details === null || !('reason' in details)) return null;
  const reason = details.reason;
  return typeof reason === 'string' && /^[A-Z_]+$/.test(reason) ? reason : null;
}

function untilOf(details: unknown): string | null {
  if (typeof details !== 'object' || details === null || !('until' in details)) return null;
  const until = details.until;
  return typeof until === 'string' && !Number.isNaN(Date.parse(until)) ? until : null;
}
