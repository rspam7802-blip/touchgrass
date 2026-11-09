import { describe, expect, it } from 'vitest';
import { AppSettingKey, UpdateAppSettingBody, UpdateFeatureFlagBody } from './admin';
import { DeviceInfo, InviteCodeInput, OtpRequestBody, OtpVerifyBody, RefreshBody } from './auth';
import { LocalizedName } from './catalog';
import { BulkInviteBody } from './invites';
import { CreateUploadBody, ImageContentType } from './media';
import { SetInterestsBody, SetPhotosBody, SetVibeTagsBody, UpdateProfileBody } from './profile';
import {
  DeleteAccountBody,
  RecordConsentBody,
  RegisterDeviceBody,
  UpdateLanguageBody,
  UpdateNotificationPreferencesBody,
  UpdatePrivacyBody,
} from './settings';

const uuid = '0192f3a4-5b6c-7d8e-9f01-23456789abcd';
const device = { deviceId: 'device-123456', platform: 'android' };

describe('auth schemas', () => {
  it('normalises invite codes to upper case and rejects symbols', () => {
    expect(InviteCodeInput.parse('  grass-2026 ')).toBe('GRASS-2026');
    expect(InviteCodeInput.safeParse('ab!!cd').success).toBe(false);
    expect(InviteCodeInput.safeParse('abc').success).toBe(false);
  });
  it('requires a 6-digit code and fills device defaults', () => {
    const parsed = OtpVerifyBody.parse({ phone: '9848022338', code: '123456', device });
    expect(parsed.device).toEqual({ ...device, name: 'Unknown device', appVersion: '0.0.0' });
    expect(OtpVerifyBody.safeParse({ phone: '9848022338', code: '12345', device }).success).toBe(
      false,
    );
    expect(OtpVerifyBody.safeParse({ phone: '9848022338', code: '12a456', device }).success).toBe(
      false,
    );
    expect(DeviceInfo.safeParse({ ...device, platform: 'symbian' }).success).toBe(false);
    expect(OtpRequestBody.safeParse({ phone: '1' }).success).toBe(false);
    expect(RefreshBody.safeParse({ refreshToken: 'short' }).success).toBe(false);
  });
});

describe('profile schemas', () => {
  it('accepts partial updates but not empty ones', () => {
    expect(UpdateProfileBody.parse({ displayName: '  Priya  ' })).toEqual({ displayName: 'Priya' });
    expect(UpdateProfileBody.safeParse({}).success).toBe(false);
    expect(UpdateProfileBody.safeParse({ displayName: 'P' }).success).toBe(false);
    expect(UpdateProfileBody.safeParse({ dateOfBirth: '20/05/1998' }).success).toBe(false);
    expect(
      UpdateProfileBody.safeParse({ gender: null, pronouns: null, neighbourhoodId: null }).success,
    ).toBe(true);
    expect(UpdateProfileBody.safeParse({ bio: 'x'.repeat(301) }).success).toBe(false);
  });
  it('bounds interests, vibes and photos', () => {
    expect(SetInterestsBody.safeParse({ interestIds: [uuid, uuid] }).success).toBe(false);
    expect(SetInterestsBody.safeParse({ interestIds: [uuid, uuid, uuid] }).success).toBe(true);
    expect(SetVibeTagsBody.safeParse({ vibeTagIds: Array(6).fill(uuid) }).success).toBe(false);
    expect(SetPhotosBody.safeParse({ mediaAssetIds: Array(7).fill(uuid) }).success).toBe(false);
  });
});

describe('media, settings and admin schemas', () => {
  it('limits upload types and sizes (no HEIC: the app converts to JPEG)', () => {
    expect(ImageContentType.options).toEqual(['image/jpeg', 'image/png', 'image/webp']);
    expect(
      CreateUploadBody.safeParse({
        purpose: 'profile_photo',
        contentType: 'image/heic',
        sizeBytes: 10,
      }).success,
    ).toBe(false);
    expect(
      CreateUploadBody.safeParse({
        purpose: 'profile_photo',
        contentType: 'image/jpeg',
        sizeBytes: 10 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
  });
  it('accepts video only for stories, up to 30 MB (D-164)', () => {
    const video = { contentType: 'video/mp4', sizeBytes: 25 * 1024 * 1024 };
    expect(CreateUploadBody.safeParse({ purpose: 'story', ...video }).success).toBe(true);
    expect(
      CreateUploadBody.safeParse({ purpose: 'story', contentType: 'video/quicktime', sizeBytes: 9 })
        .success,
    ).toBe(true);
    expect(CreateUploadBody.safeParse({ purpose: 'profile_photo', ...video }).success).toBe(false);
    expect(
      CreateUploadBody.safeParse({ purpose: 'story', ...video, sizeBytes: 30 * 1024 * 1024 + 1 })
        .success,
    ).toBe(false);
    expect(
      CreateUploadBody.safeParse({ purpose: 'story', contentType: 'video/webm', sizeBytes: 9 })
        .success,
    ).toBe(false);
  });
  it('validates settings payloads', () => {
    expect(UpdatePrivacyBody.safeParse({}).success).toBe(false);
    expect(UpdatePrivacyBody.parse({ readReceipts: false })).toEqual({ readReceipts: false });
    expect(UpdateLanguageBody.safeParse({ language: 'fr' }).success).toBe(false);
    expect(UpdateNotificationPreferencesBody.safeParse({ items: [] }).success).toBe(false);
    expect(
      RecordConsentBody.safeParse({ kind: 'telepathy', granted: true, version: '1' }).success,
    ).toBe(false);
    expect(
      RegisterDeviceBody.safeParse({ expoPushToken: 'ExponentPushToken[x]', platform: 'ios' })
        .success,
    ).toBe(true);
    expect(DeleteAccountBody.safeParse({ confirm: 'delete' }).success).toBe(false);
    expect(LocalizedName.safeParse({ en: 'Chai', te: 'చాయ్' }).success).toBe(false);
  });
  it('validates admin payloads with defaults', () => {
    expect(BulkInviteBody.parse({ count: 3, label: 'Launch' })).toEqual({
      count: 3,
      label: 'Launch',
      maxUses: 1,
      expiresAt: null,
    });
    expect(BulkInviteBody.safeParse({ count: 501, label: 'x' }).success).toBe(false);
    expect(UpdateAppSettingBody.safeParse({ value: -1 }).success).toBe(false);
    expect(UpdateFeatureFlagBody.safeParse({ enabled: 'yes' }).success).toBe(false);
    expect(AppSettingKey.options).toEqual([
      'invites_per_user',
      'waitlist_claim_minutes',
      'platform_fee_bps',
      'payout_delay_hours',
      'referral_priority_passes',
      'referral_credits',
      'referral_credit_max_rupees',
      'referral_max_rewarded',
    ]);
  });
});
