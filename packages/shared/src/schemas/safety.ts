import { z } from 'zod';
import { LIMITS } from '../constants';
import { Severity, UserStatus, VerificationStatus } from '../enums';
import { E164Phone, GeoPoint } from './common';
import { MediaVariants } from './media';
import { PersonCard } from './social';

const S = LIMITS.safety;
const M = LIMITS.moderation;

// ---------- verification (F-SAF-01) ----------

/** Poses a selfie must show, picked at random per attempt so an old photo can't be reused. */
export const VERIFICATION_POSES = [
  'thumbs_up',
  'peace_sign',
  'hand_on_cheek',
  'point_at_camera',
  'wave',
  'three_fingers',
] as const;
export const VerificationPose = z.enum(VERIFICATION_POSES);
export type VerificationPose = z.infer<typeof VerificationPose>;

export const VerificationRejectReason = z.enum([
  'POSE_MISMATCH',
  'FACE_MISMATCH',
  'UNCLEAR',
  'NOT_A_PERSON',
  'OTHER',
]);
export type VerificationRejectReason = z.infer<typeof VerificationRejectReason>;

export const MyVerification = z.object({
  status: VerificationStatus,
  verified: z.boolean(),
  /** The open pose challenge, if one was started and not yet answered. */
  challenge: z
    .object({ id: z.uuid(), pose: VerificationPose, expiresAt: z.iso.datetime() })
    .nullable(),
  submittedAt: z.iso.datetime().nullable(),
  rejectReason: VerificationRejectReason.nullable(),
  attemptsLeftToday: z.number().int(),
});
export type MyVerification = z.infer<typeof MyVerification>;

export const SubmitVerificationBody = z.object({ challengeId: z.uuid(), mediaId: z.uuid() });
export type SubmitVerificationBody = z.infer<typeof SubmitVerificationBody>;

export const AdminVerification = z.object({
  id: z.uuid(),
  user: z.object({ id: z.uuid(), displayName: z.string(), gender: z.string().nullable() }),
  pose: VerificationPose,
  selfie: MediaVariants.nullable(),
  profilePhotos: z.array(MediaVariants),
  /** Automated face comparison against the profile photos (0–100), when the adapter could tell. */
  faceSimilarity: z.number().nullable(),
  submittedAt: z.iso.datetime(),
});
export type AdminVerification = z.infer<typeof AdminVerification>;
export const AdminVerificationList = z.object({
  items: z.array(AdminVerification),
  nextCursor: z.string().nullable(),
});
export type AdminVerificationList = z.infer<typeof AdminVerificationList>;

export const ReviewVerificationBody = z
  .object({
    decision: z.enum(['approved', 'rejected']),
    reason: VerificationRejectReason.nullable().default(null),
  })
  .refine((b) => b.decision === 'approved' || b.reason !== null, {
    message: 'Say why it was rejected',
    path: ['reason'],
  });
export type ReviewVerificationBody = z.infer<typeof ReviewVerificationBody>;

// ---------- trusted contacts and live location (F-SAF-04) ----------

export const TrustedContactBody = z.object({
  name: z.string().trim().min(1).max(S.contactNameMaxLength),
  phone: E164Phone,
});
export type TrustedContactBody = z.infer<typeof TrustedContactBody>;
export const TrustedContact = TrustedContactBody.extend({ id: z.uuid() });
export type TrustedContact = z.infer<typeof TrustedContact>;
export const TrustedContactList = z.object({ items: z.array(TrustedContact) });
export type TrustedContactList = z.infer<typeof TrustedContactList>;

export const StartShareBody = z.object({
  /** The plan this share is for (its details show on the viewer); null shares location only. */
  eventId: z.uuid().nullable().default(null),
  minutes: z.number().int().min(S.shareMinMinutes).max(S.shareMaxMinutes),
});
export type StartShareBody = z.infer<typeof StartShareBody>;

export const LocationPointBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(S.maxAccuracyMeters).nullable().default(null),
});
export type LocationPointBody = z.infer<typeof LocationPointBody>;
export const SosBody = z.object({ point: LocationPointBody.nullable().default(null) });
export type SosBody = z.infer<typeof SosBody>;

export const LiveShare = z.object({
  id: z.uuid(),
  eventId: z.uuid().nullable(),
  startedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  sosAt: z.iso.datetime().nullable(),
  active: z.boolean(),
  contactsNotified: z.number().int(),
  lastPointAt: z.iso.datetime().nullable(),
  /** The signed viewer link the contacts got, to resend over WhatsApp or anything else. */
  link: z.url(),
});
export type LiveShare = z.infer<typeof LiveShare>;
export const MyLiveShare = z.object({ share: LiveShare.nullable() });
export type MyLiveShare = z.infer<typeof MyLiveShare>;

/** What a trusted contact sees on the public page (no login, signed expiring link). */
export const PublicLiveView = z.object({
  name: z.string(),
  status: z.enum(['active', 'ended']),
  sos: z.boolean(),
  startedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  lastPoint: GeoPoint.extend({ accuracy: z.number().nullable(), at: z.iso.datetime() }).nullable(),
  /** Oldest first. */
  trail: z.array(GeoPoint.extend({ at: z.iso.datetime() })),
  event: z
    .object({
      title: z.string(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      place: z.string().nullable(),
    })
    .nullable(),
});
export type PublicLiveView = z.infer<typeof PublicLiveView>;

// ---------- moderation tooling (F-SAF-05, F-SAF-06) ----------

export const SanctionKind = z.enum(['warn', 'mute', 'suspend', 'ban']);
export type SanctionKind = z.infer<typeof SanctionKind>;

export const SanctionBody = z
  .object({
    kind: SanctionKind,
    /** Mute and suspend last this many days; warnings and bans don't expire. */
    days: z.number().int().min(1).max(M.maxSanctionDays).nullable().default(null),
    reason: z.string().trim().min(3).max(M.reasonMaxLength),
  })
  .refine((b) => (b.kind === 'mute' || b.kind === 'suspend') === (b.days !== null), {
    message: 'Mutes and suspensions need a length; warnings and bans do not',
    path: ['days'],
  });
export type SanctionBody = z.infer<typeof SanctionBody>;

export const ResolveModerationBody = z.object({
  /** dismiss: nothing wrong (held content is released); remove: take the content down. */
  outcome: z.enum(['dismiss', 'remove']),
  /** Optionally also sanction the content's owner. */
  sanction: SanctionBody.nullable().default(null),
  note: z.string().trim().max(M.reasonMaxLength).default(''),
});
export type ResolveModerationBody = z.infer<typeof ResolveModerationBody>;

/** What reviewers see of the reported or flagged thing. */
export const ModerationPreview = z.object({
  title: z.string(),
  text: z.string().nullable(),
  image: MediaVariants.nullable(),
  owner: z.object({ id: z.uuid(), displayName: z.string() }).nullable(),
  /** Already gone (deleted, removed or erased). */
  gone: z.boolean(),
});
export type ModerationPreview = z.infer<typeof ModerationPreview>;

export const ModerationItemDetail = z.object({
  id: z.uuid(),
  targetType: z.string(),
  targetId: z.uuid(),
  source: z.string(),
  severity: Severity,
  status: z.enum(['open', 'actioned', 'dismissed']),
  details: z.record(z.string(), z.unknown()),
  reportCount: z.number().int(),
  createdAt: z.iso.datetime(),
  preview: ModerationPreview,
});
export type ModerationItemDetail = z.infer<typeof ModerationItemDetail>;

export const UserSanction = z.object({
  id: z.uuid(),
  kind: SanctionKind,
  reason: z.string(),
  until: z.iso.datetime().nullable(),
  liftedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  byName: z.string().nullable(),
});
export type UserSanction = z.infer<typeof UserSanction>;

export const AdminUserSummary = z.object({
  id: z.uuid(),
  displayName: z.string().nullable(),
  phoneLast4: z.string().nullable(),
  status: UserStatus,
  verified: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type AdminUserSummary = z.infer<typeof AdminUserSummary>;
export const AdminUserList = z.object({ items: z.array(AdminUserSummary) });
export type AdminUserList = z.infer<typeof AdminUserList>;
export const AdminUserQuery = z.object({ q: z.string().trim().min(2).max(100) });
export type AdminUserQuery = z.infer<typeof AdminUserQuery>;

export const AdminUserDetail = AdminUserSummary.extend({
  person: PersonCard.nullable(),
  roles: z.array(z.string()),
  sanctions: z.array(UserSanction),
  reportsAgainst: z.number().int(),
  mutedUntil: z.iso.datetime().nullable(),
  suspendedUntil: z.iso.datetime().nullable(),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;
