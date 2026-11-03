import { Injectable } from '@nestjs/common';
import { maskPhone, type MeResponse } from '@touchgrass/shared';
import { AppError } from '../../common/errors/app-error.js';
import { InterestsService } from '../interests/interests.service.js';
import { SanctionsReader } from '../moderation/sanctions-reader.js';
import { ProfilesService } from '../profiles/profiles.service.js';
import { ProfileStatsReader } from '../profiles/profile-stats.port.js';
import { UsersService } from '../users/users.service.js';

/** Assembles the signed-in user's own profile view from the modules that own each part. */
@Injectable()
export class MeService {
  constructor(
    private readonly users: UsersService,
    private readonly profiles: ProfilesService,
    private readonly interests: InterestsService,
    private readonly stats: ProfileStatsReader,
    private readonly sanctions: SanctionsReader,
  ) {}

  async me(userId: string): Promise<MeResponse> {
    const [user, profile] = await Promise.all([
      this.users.findById(userId),
      this.profiles.get(userId),
    ]);
    if (!user || !profile) throw AppError.notFound('Account');
    const [roles, photos, interestIds, vibeIds, onboarding, stats] = await Promise.all([
      this.users.rolesOf(userId),
      this.profiles.photos(userId, true),
      this.profiles.interestIdsOf(userId),
      this.profiles.vibeTagIdsOf(userId),
      this.profiles.onboardingState(userId),
      this.stats.statsFor([userId]),
    ]);
    return {
      id: user.id,
      status: user.status,
      phoneMasked: user.phoneE164 ? maskPhone(user.phoneE164) : '',
      language: user.language,
      roles,
      displayName: profile.displayName,
      bio: profile.bio,
      bioHeld: profile.bioHeldAt !== null,
      mutedUntil: (await this.sanctions.mutedUntil(userId))?.toISOString() ?? null,
      dateOfBirth: profile.dateOfBirth,
      gender: profile.gender,
      pronouns: profile.pronouns,
      cityId: profile.cityId,
      neighbourhoodId: profile.neighbourhoodId,
      spokenLanguages: profile.spokenLanguages,
      visibility: profile.visibility,
      photos,
      interests: await this.interests.interestsByIds(interestIds),
      vibeTags: await this.interests.vibeTagsByIds(vibeIds),
      stats: stats.get(userId) ?? { eventsAttended: 0, eventsHosted: 0, reliabilityTier: 'new' },
      onboarding: {
        ...onboarding,
        complete: onboarding.complete && profile.onboardingCompletedAt !== null,
      },
      tutorialComplete: profile.tutorialCompletedAt !== null,
      verified: user.verifiedAt !== null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
