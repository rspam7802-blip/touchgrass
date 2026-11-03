import { z } from 'zod';
import { SUPPORTED_LANGUAGES } from '../constants';
import { ConsentKind, DevicePlatform, NotificationCategory, ProfileVisibility } from '../enums';

export const NotificationPreference = z.object({
  category: NotificationCategory,
  push: z.boolean(),
  inApp: z.boolean(),
});
export type NotificationPreference = z.infer<typeof NotificationPreference>;
export const NotificationPreferences = z.object({ items: z.array(NotificationPreference) });
export const UpdateNotificationPreferencesBody = z.object({
  items: z.array(NotificationPreference).min(1),
});

export const PrivacySettings = z.object({
  profileVisibility: ProfileVisibility,
  showFirstTimerBadge: z.boolean(),
  readReceipts: z.boolean(),
  showInWhoIsGoing: z.boolean(),
  /** Squad sees what you pull up to, plot, earn and post (F-SOC-04). */
  shareActivity: z.boolean(),
  /** People who have your number can find you via contact matching (F-SOC-01). */
  discoverableByContacts: z.boolean(),
});
export type PrivacySettings = z.infer<typeof PrivacySettings>;
export const UpdatePrivacyBody = PrivacySettings.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'Provide at least one field' },
);

export const UpdateLanguageBody = z.object({ language: z.enum(SUPPORTED_LANGUAGES) });

export const RecordConsentBody = z.object({
  kind: ConsentKind,
  granted: z.boolean(),
  version: z.string().min(1).max(20),
});
export type RecordConsentBody = z.infer<typeof RecordConsentBody>;

export const RegisterDeviceBody = z.object({
  expoPushToken: z.string().min(10).max(200),
  platform: DevicePlatform,
});
export type RegisterDeviceBody = z.infer<typeof RegisterDeviceBody>;

export const DeleteAccountBody = z.object({ confirm: z.literal('DELETE') });
export const DeletionScheduledResponse = z.object({ purgeAfter: z.iso.datetime() });
export type UpdateNotificationPreferencesBody = z.infer<typeof UpdateNotificationPreferencesBody>;
export type UpdatePrivacyBody = z.infer<typeof UpdatePrivacyBody>;
export type UpdateLanguageBody = z.infer<typeof UpdateLanguageBody>;
export type DeleteAccountBody = z.infer<typeof DeleteAccountBody>;
