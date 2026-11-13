import { z } from 'zod';
import { HostRatingSummary } from './after';
import { LIMITS } from '../constants';
import { Gender, ProfileVisibility, ReliabilityTier, UserStatus } from '../enums';
import { Interest, VibeTag } from './catalog';
import { MediaVariants } from './media';
import { RelationshipStatus } from './social';

const P = LIMITS.profile;

export const DateOfBirth = z.iso.date();

export const UpdateProfileBody = z
  .object({
    displayName: z.string().trim().min(P.displayNameMin).max(P.displayNameMax),
    bio: z.string().trim().max(P.bioMaxLength),
    dateOfBirth: DateOfBirth,
    gender: Gender.nullable(),
    pronouns: z.string().trim().max(P.pronounsMax).nullable(),
    cityId: z.uuid(),
    neighbourhoodId: z.uuid().nullable(),
    spokenLanguages: z.array(z.string().trim().min(2).max(30)).max(P.maxSpokenLanguages),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field' });
export type UpdateProfileBody = z.infer<typeof UpdateProfileBody>;

export const SetInterestsBody = z.object({
  interestIds: z.array(z.uuid()).min(P.minInterests).max(P.maxInterests),
});
export const SetVibeTagsBody = z.object({ vibeTagIds: z.array(z.uuid()).max(P.maxVibeTags) });
export const SetPhotosBody = z.object({ mediaAssetIds: z.array(z.uuid()).min(0).max(P.maxPhotos) });

export const ProfilePhoto = z.object({
  mediaAssetId: z.uuid(),
  position: z.number().int(),
  urls: MediaVariants.nullable(),
  status: z.string(),
});
export type ProfilePhoto = z.infer<typeof ProfilePhoto>;

export const ProfileStats = z.object({
  eventsAttended: z.number().int(),
  eventsHosted: z.number().int(),
  reliabilityTier: ReliabilityTier,
});
export type ProfileStats = z.infer<typeof ProfileStats>;

export const OnboardingState = z.object({
  name: z.boolean(),
  photos: z.boolean(),
  /** A verification selfie is in review or approved, or none is required (D-181). */
  verification: z.boolean(),
  dateOfBirth: z.boolean(),
  city: z.boolean(),
  interests: z.boolean(),
  complete: z.boolean(),
});
export type OnboardingState = z.infer<typeof OnboardingState>;

/** The signed-in user's own full profile. */
export const MeResponse = z.object({
  id: z.uuid(),
  status: UserStatus,
  phoneMasked: z.string(),
  language: z.string(),
  roles: z.array(z.string()),
  displayName: z.string().nullable(),
  bio: z.string(),
  /** The bio tripped the text filter: only you see it until it is reviewed (F-SAF-06). */
  bioHeld: z.boolean(),
  /** Muted by a moderator: no posting or messaging until then (F-SAF-05). */
  mutedUntil: z.iso.datetime().nullable(),
  dateOfBirth: z.string().nullable(),
  gender: Gender.nullable(),
  pronouns: z.string().nullable(),
  cityId: z.uuid().nullable(),
  neighbourhoodId: z.uuid().nullable(),
  spokenLanguages: z.array(z.string()),
  visibility: ProfileVisibility,
  photos: z.array(ProfilePhoto),
  interests: z.array(Interest),
  vibeTags: z.array(VibeTag),
  stats: ProfileStats,
  onboarding: OnboardingState,
  tutorialComplete: z.boolean(),
  verified: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type MeResponse = z.infer<typeof MeResponse>;

/** Another person's profile, already filtered by privacy rules. */
export const PublicProfile = z.object({
  id: z.uuid(),
  displayName: z.string(),
  bio: z.string(),
  age: z.number().int().nullable(),
  pronouns: z.string().nullable(),
  neighbourhoodName: z.string().nullable(),
  spokenLanguages: z.array(z.string()),
  photos: z.array(MediaVariants),
  interests: z.array(Interest),
  vibeTags: z.array(VibeTag),
  sharedInterestIds: z.array(z.uuid()),
  mutualFriends: z.object({
    count: z.number().int(),
    sample: z.array(z.object({ id: z.uuid(), displayName: z.string() })),
  }),
  stats: ProfileStats,
  verified: z.boolean(),
  limited: z.boolean(),
  relationship: RelationshipStatus,
  /** As a host (F-AFT-05); null until they have enough ratings. */
  hostRating: HostRatingSummary.nullable(),
});
export type PublicProfile = z.infer<typeof PublicProfile>;
export type SetInterestsBody = z.infer<typeof SetInterestsBody>;
export type SetVibeTagsBody = z.infer<typeof SetVibeTagsBody>;
export type SetPhotosBody = z.infer<typeof SetPhotosBody>;
