import { z } from 'zod';
import { LIMITS } from '../constants';
import { DevicePlatform, UserStatus } from '../enums';

/** Accepts any common Indian format; the server normalises to E.164. */
export const PhoneInput = z.string().trim().min(6).max(20);

export const InviteCodeInput = z
  .string()
  .trim()
  .min(4)
  .max(32)
  .transform((s) => s.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9-]+$/));

export const OtpRequestBody = z.object({ phone: PhoneInput });
export type OtpRequestBody = z.infer<typeof OtpRequestBody>;
export const OtpRequestResponse = z.object({
  expiresAt: z.iso.datetime(),
  resendAfterSeconds: z.number().int(),
});
export type OtpRequestResponse = z.infer<typeof OtpRequestResponse>;

export const DeviceInfo = z.object({
  deviceId: z.string().min(8).max(128),
  name: z.string().max(80).default('Unknown device'),
  platform: DevicePlatform,
  appVersion: z.string().max(20).default('0.0.0'),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

export const OtpVerifyBody = z.object({
  phone: PhoneInput,
  code: z.string().regex(new RegExp(`^\\d{${LIMITS.otp.length}}$`), 'Code must be 6 digits'),
  inviteCode: InviteCodeInput.optional(),
  /** +1 claim token from a friend's event invite: skips the invite gate (F-EVT-07). */
  claimToken: z.string().min(20).max(100).optional(),
  device: DeviceInfo,
});
export type OtpVerifyBody = z.infer<typeof OtpVerifyBody>;

export const SessionUser = z.object({
  id: z.uuid(),
  status: UserStatus,
  onboardingComplete: z.boolean(),
  tutorialComplete: z.boolean(),
  roles: z.array(z.string()),
});
export type SessionUser = z.infer<typeof SessionUser>;

export const AuthTokens = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  sessionId: z.uuid(),
});
export type AuthTokens = z.infer<typeof AuthTokens>;

export const AuthResponse = AuthTokens.extend({ user: SessionUser, isNewUser: z.boolean() });
export type AuthResponse = z.infer<typeof AuthResponse>;

export const RefreshBody = z.object({ refreshToken: z.string().min(20).max(200) });
export type RefreshBody = z.infer<typeof RefreshBody>;

export const InviteCheckBody = z.object({ code: InviteCodeInput });
export const InviteCheckResponse = z.object({
  valid: z.boolean(),
  inviterName: z.string().nullable(),
});
export type InviteCheckResponse = z.infer<typeof InviteCheckResponse>;

export const SessionSummary = z.object({
  id: z.uuid(),
  deviceName: z.string(),
  platform: DevicePlatform,
  appVersion: z.string(),
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;
export const SessionList = z.object({ items: z.array(SessionSummary) });
export type InviteCheckBody = z.infer<typeof InviteCheckBody>;
