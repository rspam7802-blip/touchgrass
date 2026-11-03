import { z } from 'zod';

export const EventType = z.enum(['curated', 'plan', 'crew_session']);
export const EventStatus = z.enum(['draft', 'published', 'cancelled', 'completed']);
export const EventVisibility = z.enum([
  'public',
  'friends_of_friends',
  'invite_only',
  'women_only',
  'balanced',
]);
/** `held`: a spot reserved while the person pays (10 minutes); not yet going. */
export const RsvpStatus = z.enum([
  'going',
  'interested',
  'waitlisted',
  'cancelled',
  'checked_in',
  'held',
]);
export const HostRole = z.enum(['host', 'co_host', 'welcome_host']);
export const AdminRole = z.enum(['super_admin', 'admin', 'moderator', 'city_curator', 'support']);
export const Gender = z.enum(['woman', 'man', 'non_binary', 'prefer_not_to_say']);
export const ProfileVisibility = z.enum(['everyone', 'friends_of_friends', 'squad_only']);
export const FriendshipStatus = z.enum(['pending', 'accepted', 'declined', 'cancelled']);
export const ConversationType = z.enum(['dm', 'event', 'crew']);
export const ReportTargetType = z.enum(['user', 'event', 'message', 'lore_media', 'story']);
export const ReportCategory = z.enum([
  'harassment',
  'hate_speech',
  'nudity',
  'violence',
  'spam',
  'scam',
  'impersonation',
  'underage',
  'unsafe_event',
  'other',
]);
export const Severity = z.enum(['low', 'medium', 'high', 'critical']);
export const ModerationAction = z.enum([
  'warn',
  'mute',
  'suspend',
  'ban',
  'remove_content',
  'dismiss',
]);
export const VerificationStatus = z.enum(['none', 'pending', 'approved', 'rejected']);
export const CityLaunchStatus = z.enum(['waitlist', 'beta', 'launched']);
export const ReliabilityTier = z.enum([
  'new',
  'super_reliable',
  'reliable',
  'hit_or_miss',
  'flaky',
]);
export const NotificationCategory = z.enum([
  'squad',
  'event_updates',
  'reminders',
  'chat',
  'waitlist',
  'badges',
  'streaks',
  'recaps',
  'free_now',
  'safety',
  'marketing',
]);
export const MediaPurpose = z.enum([
  'profile_photo',
  'event_cover',
  'lore',
  'chat',
  'verification_selfie',
  'report_screenshot',
  'story',
]);
export const UserStatus = z.enum([
  'onboarding',
  'active',
  'age_blocked',
  'suspended',
  'banned',
  'deletion_pending',
  'deleted',
]);
export const ConsentKind = z.enum([
  'terms',
  'privacy',
  'age_confirmation',
  'notifications',
  'contacts',
  'location',
  'marketing',
]);
export const DevicePlatform = z.enum(['ios', 'android', 'web']);
export const MediaStatus = z.enum([
  'pending_upload',
  'processing',
  'ready',
  'flagged',
  'rejected',
  'deleted',
]);
export const ModerationStatus = z.enum(['open', 'actioned', 'dismissed']);
export const ModerationVerdict = z.enum(['pending', 'safe', 'flagged', 'rejected']);

export type EventType = z.infer<typeof EventType>;
export type EventStatus = z.infer<typeof EventStatus>;
export type EventVisibility = z.infer<typeof EventVisibility>;
export type RsvpStatus = z.infer<typeof RsvpStatus>;
export type HostRole = z.infer<typeof HostRole>;
export type AdminRole = z.infer<typeof AdminRole>;
export type Gender = z.infer<typeof Gender>;
export type ProfileVisibility = z.infer<typeof ProfileVisibility>;
export type FriendshipStatus = z.infer<typeof FriendshipStatus>;
export type ConversationType = z.infer<typeof ConversationType>;
export type ReportTargetType = z.infer<typeof ReportTargetType>;
export type ReportCategory = z.infer<typeof ReportCategory>;
export type Severity = z.infer<typeof Severity>;
export type ModerationAction = z.infer<typeof ModerationAction>;
export type VerificationStatus = z.infer<typeof VerificationStatus>;
export type CityLaunchStatus = z.infer<typeof CityLaunchStatus>;
export type ReliabilityTier = z.infer<typeof ReliabilityTier>;
export type NotificationCategory = z.infer<typeof NotificationCategory>;
export type MediaPurpose = z.infer<typeof MediaPurpose>;
export type ModerationVerdict = z.infer<typeof ModerationVerdict>;
export type UserStatus = z.infer<typeof UserStatus>;
export type ConsentKind = z.infer<typeof ConsentKind>;
export type DevicePlatform = z.infer<typeof DevicePlatform>;
export type MediaStatus = z.infer<typeof MediaStatus>;
export type ModerationStatus = z.infer<typeof ModerationStatus>;
