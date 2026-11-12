import { Inject, Injectable } from '@nestjs/common';
import {
  ageInYears,
  type Gender,
  type Interest,
  isAdult,
  LIMITS,
  type OnboardingState,
  type PrivacySettings,
  type MediaVariants,
  type ModerationPreview,
  type ProfilePhoto,
  type PublicProfile,
  type PublicProfileView,
  type UpdateProfileBody,
  type VibeTag,
} from '@touchgrass/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import {
  profilePhotos,
  profiles,
  userInterests,
  userVibeTags,
} from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { CitiesService } from '../cities/cities.service.js';
import { CityWaitlistService } from '../cities/city-waitlist.service.js';
import { InterestsService } from '../interests/interests.service.js';
import { MediaService } from '../media/media.service.js';
import { type AfterCommit, GONE } from '../moderation/moderation-targets.js';
import { ModerationService } from '../moderation/moderation.service.js';
import { UsersService } from '../users/users.service.js';
import { profileAccess } from './profile.policy.js';
import { ProfileStatsReader } from './profile-stats.port.js';
import { HostRatingReader } from '../feedback/host-rating-reader.js';
import { SocialGraphService } from '../social/graph/social-graph.service.js';

export type ProfileRow = typeof profiles.$inferSelect;
export type ProfileUpdateResult = { kind: 'updated' } | { kind: 'underage' };

/** Owns profiles, profile photos, user interests and user vibe tags. */
@Injectable()
export class ProfilesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly users: UsersService,
    private readonly cities: CitiesService,
    private readonly waitlist: CityWaitlistService,
    private readonly interests: InterestsService,
    private readonly media: MediaService,
    private readonly graph: SocialGraphService,
    private readonly stats: ProfileStatsReader,
    private readonly hostRatings: HostRatingReader,
    private readonly moderation: ModerationService,
  ) {}

  async ensure(userId: string, tx: DbOrTx): Promise<void> {
    await tx.insert(profiles).values({ userId }).onConflictDoNothing();
  }

  async get(userId: string, db: DbOrTx = this.db): Promise<ProfileRow | null> {
    const [row] = await db.select().from(profiles).where(eq(profiles.userId, userId)).limit(1);
    return row ?? null;
  }

  /** Self-declared gender (verification of it lives on the user). */
  async genderOf(userId: string, db: DbOrTx = this.db): Promise<Gender | null> {
    const [row] = await db
      .select({ gender: profiles.gender })
      .from(profiles)
      .where(eq(profiles.userId, userId))
      .limit(1);
    return row?.gender ?? null;
  }

  async getOrThrow(userId: string): Promise<ProfileRow> {
    const row = await this.get(userId);
    if (!row) throw AppError.notFound('Profile');
    return row;
  }

  async displayNames(userIds: string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: profiles.userId, name: profiles.displayName })
      .from(profiles)
      .where(inArray(profiles.userId, userIds));
    return new Map(rows.flatMap((r) => (r.name ? [[r.id, r.name] as const] : [])));
  }

  /**
   * Applies a partial profile update. A date of birth under 18 is NOT stored; the caller (account module)
   * then age-blocks the account (F-ACC-03).
   */
  async update(
    userId: string,
    body: UpdateProfileBody,
    now: Date = new Date(),
  ): Promise<ProfileUpdateResult> {
    if (body.dateOfBirth !== undefined) {
      if (
        ageInYears(body.dateOfBirth, now) > 120 ||
        new Date(body.dateOfBirth).getTime() > now.getTime()
      ) {
        throw new AppError('VALIDATION_FAILED', 'Date of birth is not plausible', [
          { path: 'dateOfBirth', message: 'Not plausible', code: 'custom' },
        ]);
      }
      if (!isAdult(body.dateOfBirth, now)) return { kind: 'underage' };
    }
    const current = await this.getOrThrow(userId);
    const cityId = body.cityId ?? current.cityId;
    if (body.cityId !== undefined && !(await this.cities.exists(body.cityId)))
      throw new AppError('VALIDATION_FAILED', 'Unknown city');
    // Cities still on the waitlist can't be lived in yet: people join that city's waitlist instead.
    if (body.cityId !== undefined && !(await this.cities.isOpen(body.cityId)))
      throw new AppError('NOT_ELIGIBLE', 'That city is not open yet', {
        reason: 'CITY_NOT_LAUNCHED',
      });
    let neighbourhoodId =
      body.neighbourhoodId === undefined ? current.neighbourhoodId : body.neighbourhoodId;
    if (
      body.cityId !== undefined &&
      body.cityId !== current.cityId &&
      body.neighbourhoodId === undefined
    )
      neighbourhoodId = null;
    if (
      neighbourhoodId &&
      (!cityId || !(await this.cities.neighbourhoodInCity(neighbourhoodId, cityId)))
    ) {
      throw new AppError('VALIDATION_FAILED', 'Neighbourhood is not in the selected city');
    }
    // Names show up everywhere (cards, chats, pushes), so a flagged one is refused rather than held.
    if (body.displayName && this.moderation.screen(body.displayName).flagged)
      throw new AppError('VALIDATION_FAILED', 'Pick a different name', [
        { path: 'displayName', message: 'Pick a different name', code: 'custom' },
      ]);
    const bioScreen = this.moderation.screen(body.bio);
    await this.db.transaction(async (tx) => {
      await tx
        .update(profiles)
        .set({
          ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
          ...(body.bio !== undefined
            ? { bio: body.bio, bioHeldAt: bioScreen.flagged ? now : null }
            : {}),
          ...(body.dateOfBirth !== undefined ? { dateOfBirth: body.dateOfBirth } : {}),
          ...(body.gender !== undefined ? { gender: body.gender } : {}),
          ...(body.pronouns !== undefined ? { pronouns: body.pronouns } : {}),
          ...(body.spokenLanguages !== undefined
            ? { spokenLanguages: [...new Set(body.spokenLanguages)] }
            : {}),
          cityId,
          neighbourhoodId,
        })
        .where(eq(profiles.userId, userId));
      if (body.cityId !== undefined) {
        await this.users.setCity(userId, body.cityId, tx);
        // Living in an open city now: no longer waiting for one.
        await this.waitlist.leave(userId, tx);
      }
      await this.moderation.flagText({ type: 'user', id: userId, cityId }, bioScreen, tx);
    });
    return { kind: 'updated' };
  }

  async setInterests(userId: string, ids: string[]): Promise<Interest[]> {
    const unique = [...new Set(ids)];
    if (unique.length < LIMITS.profile.minInterests)
      throw new AppError(
        'VALIDATION_FAILED',
        `Pick at least ${LIMITS.profile.minInterests} interests`,
      );
    if (!(await this.interests.allActiveInterests(unique)))
      throw new AppError('VALIDATION_FAILED', 'Unknown interest');
    await this.db.transaction(async (tx) => {
      await tx.delete(userInterests).where(eq(userInterests.userId, userId));
      await tx.insert(userInterests).values(unique.map((interestId) => ({ userId, interestId })));
    });
    return this.interests.interestsByIds(unique);
  }

  async setVibeTags(userId: string, ids: string[]): Promise<VibeTag[]> {
    const unique = [...new Set(ids)];
    if (!(await this.interests.allActiveVibeTags(unique)))
      throw new AppError('VALIDATION_FAILED', 'Unknown vibe tag');
    await this.db.transaction(async (tx) => {
      await tx.delete(userVibeTags).where(eq(userVibeTags.userId, userId));
      if (unique.length > 0)
        await tx.insert(userVibeTags).values(unique.map((vibeTagId) => ({ userId, vibeTagId })));
    });
    return this.interests.vibeTagsByIds(unique);
  }

  async interestIdsOf(userId: string): Promise<string[]> {
    return (
      await this.db
        .select({ id: userInterests.interestId })
        .from(userInterests)
        .where(eq(userInterests.userId, userId))
    ).map((r) => r.id);
  }

  async vibeTagIdsOf(userId: string): Promise<string[]> {
    return (
      await this.db
        .select({ id: userVibeTags.vibeTagId })
        .from(userVibeTags)
        .where(eq(userVibeTags.userId, userId))
    ).map((r) => r.id);
  }

  /** Replaces the ordered photo set. Only the owner's own profile-photo uploads that are processing or ready are allowed. */
  async setPhotos(userId: string, assetIds: string[]): Promise<ProfilePhoto[]> {
    const unique = [...new Set(assetIds)];
    if (unique.length !== assetIds.length)
      throw new AppError('VALIDATION_FAILED', 'Duplicate photo');
    if (unique.length > LIMITS.profile.maxPhotos)
      throw new AppError('VALIDATION_FAILED', `At most ${LIMITS.profile.maxPhotos} photos`);
    const assets = new Map((await this.media.byIds(unique)).map((a) => [a.id, a]));
    for (const id of unique) {
      const a = assets.get(id);
      if (!a || a.ownerUserId !== userId || a.purpose !== 'profile_photo' || a.status === 'deleted')
        throw AppError.notFound('Media');
      if (a.status === 'pending_upload')
        throw new AppError('MEDIA_NOT_READY', 'Upload has not completed');
      if (a.status === 'rejected' || a.status === 'flagged')
        throw new AppError('VALIDATION_FAILED', 'This photo cannot be used');
    }
    const previous = await this.db
      .select({ id: profilePhotos.mediaAssetId })
      .from(profilePhotos)
      .where(eq(profilePhotos.userId, userId));
    await this.db.transaction(async (tx) => {
      await tx.delete(profilePhotos).where(eq(profilePhotos.userId, userId));
      if (unique.length > 0)
        await tx.insert(profilePhotos).values(
          unique.map((mediaAssetId, position) => ({
            id: uuidv7(),
            userId,
            mediaAssetId,
            position,
          })),
        );
    });
    const removed = previous.map((p) => p.id).filter((id) => !unique.includes(id));
    await this.media.destroy(removed);
    return this.photos(userId, true);
  }

  async photos(userId: string, isOwner: boolean): Promise<ProfilePhoto[]> {
    const rows = await this.db
      .select()
      .from(profilePhotos)
      .where(eq(profilePhotos.userId, userId))
      .orderBy(asc(profilePhotos.position));
    const assets = new Map(
      (await this.media.byIds(rows.map((r) => r.mediaAssetId))).map((a) => [a.id, a]),
    );
    const out: ProfilePhoto[] = [];
    for (const r of rows) {
      const a = assets.get(r.mediaAssetId);
      if (!a) continue;
      if (!isOwner && a.status !== 'ready') continue;
      out.push({
        mediaAssetId: a.id,
        position: r.position,
        status: a.status,
        urls: (await this.media.toDto(a, isOwner)).urls,
      });
    }
    return out;
  }

  async onboardingState(userId: string): Promise<OnboardingState> {
    const [profile, photos, interestIds] = await Promise.all([
      this.getOrThrow(userId),
      this.photos(userId, true),
      this.interestIdsOf(userId),
    ]);
    const state = {
      name: Boolean(profile.displayName),
      // New members need the minimum; anyone who finished onboarding under an earlier rule stays in.
      photos:
        profile.onboardingCompletedAt !== null ||
        photos.filter((p) => p.status === 'ready' || p.status === 'processing').length >=
          LIMITS.profile.minPhotos,
      dateOfBirth: profile.dateOfBirth !== null,
      city: profile.cityId !== null,
      interests: interestIds.length >= LIMITS.profile.minInterests,
    };
    return { ...state, complete: Object.values(state).every(Boolean) };
  }

  async markOnboardingComplete(userId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(profiles)
      .set({ onboardingCompletedAt: new Date() })
      .where(eq(profiles.userId, userId));
  }

  async setTutorialComplete(userId: string, complete: boolean): Promise<void> {
    await this.db
      .update(profiles)
      .set({ tutorialCompletedAt: complete ? new Date() : null })
      .where(eq(profiles.userId, userId));
  }

  async privacy(userId: string): Promise<PrivacySettings> {
    const p = await this.getOrThrow(userId);
    return {
      profileVisibility: p.visibility,
      showFirstTimerBadge: p.showFirstTimerBadge,
      readReceipts: p.readReceipts,
      showInWhoIsGoing: p.showInWhoIsGoing,
      shareActivity: p.shareActivity,
      discoverableByContacts: p.discoverableByContacts,
    };
  }

  async updatePrivacy(userId: string, patch: Partial<PrivacySettings>): Promise<PrivacySettings> {
    await this.db
      .update(profiles)
      .set({
        ...(patch.profileVisibility !== undefined ? { visibility: patch.profileVisibility } : {}),
        ...(patch.showFirstTimerBadge !== undefined
          ? { showFirstTimerBadge: patch.showFirstTimerBadge }
          : {}),
        ...(patch.readReceipts !== undefined ? { readReceipts: patch.readReceipts } : {}),
        ...(patch.showInWhoIsGoing !== undefined
          ? { showInWhoIsGoing: patch.showInWhoIsGoing }
          : {}),
        ...(patch.shareActivity !== undefined ? { shareActivity: patch.shareActivity } : {}),
        ...(patch.discoverableByContacts !== undefined
          ? { discoverableByContacts: patch.discoverableByContacts }
          : {}),
      })
      .where(eq(profiles.userId, userId));
    return this.privacy(userId);
  }

  /** Another person's profile, filtered by blocks, account status and visibility. Hidden profiles are 404. */
  async publicProfile(
    viewerId: string,
    targetId: string,
    now: Date = new Date(),
  ): Promise<PublicProfile> {
    const [target, profile] = await Promise.all([
      this.users.findById(targetId),
      this.get(targetId),
    ]);
    if (!target || !profile?.displayName) throw AppError.notFound('Profile');
    const [relationship, blocked, relationshipStatus] = await Promise.all([
      this.graph.relationship(viewerId, targetId),
      this.graph.isBlockedEitherWay(viewerId, targetId),
      this.graph.relationshipStatus(viewerId, targetId),
    ]);
    const access = profileAccess({
      relationship,
      blocked,
      targetStatus: target.status,
      visibility: profile.visibility,
    });
    if (access === 'none') throw AppError.notFound('Profile');

    const photos = (await this.photos(targetId, false)).flatMap((p) => (p.urls ? [p.urls] : []));
    const [statsMap, ratings] = await Promise.all([
      this.stats.statsFor([targetId]),
      this.hostRatings.summaries([targetId]),
    ]);
    // Shown once there are enough ratings to be fair to the host (F-AFT-05).
    const rating = ratings.get(targetId);
    const hostRating = rating && rating.average !== null ? rating : null;
    const stats = statsMap.get(targetId) ?? {
      eventsAttended: 0,
      eventsHosted: 0,
      reliabilityTier: 'new' as const,
    };
    const base = {
      id: targetId,
      displayName: profile.displayName,
      verified: target.verifiedAt !== null,
      relationship: relationshipStatus,
      hostRating,
    };
    if (access === 'limited') {
      return {
        ...base,
        bio: '',
        age: null,
        pronouns: null,
        neighbourhoodName: null,
        spokenLanguages: [],
        photos: photos.slice(0, 1),
        interests: [],
        vibeTags: [],
        sharedInterestIds: [],
        mutualFriends: await this.mutualFriends(viewerId, targetId),
        stats,
        limited: true,
      };
    }
    const [targetInterests, viewerInterests, vibeIds, neighbourhoodName, mutualFriends] =
      await Promise.all([
        this.interestIdsOf(targetId),
        this.interestIdsOf(viewerId),
        this.vibeTagIdsOf(targetId),
        this.cities.neighbourhoodName(profile.neighbourhoodId),
        this.mutualFriends(viewerId, targetId),
      ]);
    const viewerSet = new Set(viewerInterests);
    return {
      ...base,
      bio: profile.bioHeldAt ? '' : profile.bio,
      age: profile.dateOfBirth ? ageInYears(profile.dateOfBirth, now) : null,
      pronouns: profile.pronouns,
      neighbourhoodName,
      spokenLanguages: profile.spokenLanguages,
      photos,
      interests: await this.interests.interestsByIds(targetInterests),
      vibeTags: await this.interests.vibeTagsByIds(vibeIds),
      sharedInterestIds: targetInterests.filter((id) => viewerSet.has(id)),
      mutualFriends,
      stats,
      limited: false,
    };
  }

  /** Mutual squad members with names (sample) and the total count. */
  async mutualFriends(
    viewerId: string,
    targetId: string,
  ): Promise<{ count: number; sample: { id: string; displayName: string }[] }> {
    if (viewerId === targetId) return { count: 0, sample: [] };
    const blocked = await this.graph.blockedSet(viewerId);
    const ids = (await this.graph.mutualFriendIds(viewerId, targetId, 500)).filter(
      (id) => !blocked.has(id),
    );
    const active = await this.users.activeIds(ids);
    const visible = ids.filter((id) => active.has(id));
    const names = await this.displayNames(visible.slice(0, LIMITS.social.mutualSample));
    return {
      count: visible.length,
      sample: [...names.entries()].map(([id, displayName]) => ({ id, displayName })),
    };
  }

  /** Of these users, who allows contact discovery / shares activity (privacy filters for the social module). */
  /** People whose name matches (trigram or substring), best first (F-DSC-09). Callers apply visibility. */
  async searchByName(q: string, limit: number): Promise<string[]> {
    const like = `%${q.replace(/[%_\\]/g, '\\$&')}%`;
    const rows = await this.db
      .select({ id: profiles.userId })
      .from(profiles)
      .where(
        and(
          sql`${profiles.onboardingCompletedAt} IS NOT NULL`,
          sql`(${profiles.displayName} % ${q} OR ${profiles.displayName} ILIKE ${like})`,
        ),
      )
      .orderBy(sql`similarity(${profiles.displayName}, ${q}) DESC`, profiles.userId)
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /** Profile visibility settings for many people at once. */
  async visibilities(userIds: string[]): Promise<Map<string, ProfileRow['visibility']>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: profiles.userId, v: profiles.visibility })
      .from(profiles)
      .where(inArray(profiles.userId, userIds));
    return new Map(rows.map((r) => [r.id, r.v]));
  }

  async withPrivacyFlag(
    userIds: string[],
    flag:
      | 'discoverableByContacts'
      | 'shareActivity'
      | 'showInWhoIsGoing'
      | 'showFirstTimerBadge'
      | 'readReceipts',
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const column = {
      discoverableByContacts: profiles.discoverableByContacts,
      shareActivity: profiles.shareActivity,
      showInWhoIsGoing: profiles.showInWhoIsGoing,
      showFirstTimerBadge: profiles.showFirstTimerBadge,
      readReceipts: profiles.readReceipts,
    }[flag];
    const rows = await this.db
      .select({ id: profiles.userId })
      .from(profiles)
      .where(and(inArray(profiles.userId, userIds), eq(column, true)));
    return new Set(rows.map((r) => r.id));
  }

  /** People in the same city sharing at least one interest with the user, most overlap first (F-SOC-03). */
  async sharingInterests(userId: string, limit: number): Promise<{ id: string; shared: number }[]> {
    const me = await this.get(userId);
    if (!me?.cityId) return [];
    const res = await this.db.execute<{ id: string; shared: number }>(sql`
      SELECT other.user_id AS id, count(*)::int AS shared
      FROM user_interests mine
      JOIN user_interests other ON other.interest_id = mine.interest_id AND other.user_id <> mine.user_id
      JOIN profiles p ON p.user_id = other.user_id AND p.city_id = ${me.cityId} AND p.onboarding_completed_at IS NOT NULL
      WHERE mine.user_id = ${userId}
      GROUP BY other.user_id ORDER BY shared DESC, other.user_id LIMIT ${limit}`);
    return res.rows;
  }

  async sharedInterestCounts(userId: string, others: string[]): Promise<Map<string, number>> {
    if (others.length === 0) return new Map();
    const rows = await this.db
      .select({ id: userInterests.userId, n: sql<number>`count(*)::int` })
      .from(userInterests)
      .where(
        and(
          inArray(userInterests.userId, others),
          sql`${userInterests.interestId} IN (SELECT interest_id FROM user_interests WHERE user_id = ${userId})`,
        ),
      )
      .groupBy(userInterests.userId);
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  /** First ready photo per user (person cards). */
  async primaryPhotos(userIds: string[]): Promise<Map<string, MediaVariants>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({
        userId: profilePhotos.userId,
        assetId: profilePhotos.mediaAssetId,
        position: profilePhotos.position,
      })
      .from(profilePhotos)
      .where(inArray(profilePhotos.userId, userIds))
      .orderBy(asc(profilePhotos.position));
    const assets = new Map(
      (await this.media.byIds(rows.map((r) => r.assetId))).map((a) => [a.id, a]),
    );
    const out = new Map<string, MediaVariants>();
    for (const r of rows) {
      if (out.has(r.userId)) continue;
      const a = assets.get(r.assetId);
      if (a?.status !== 'ready') continue;
      const urls = await this.media.urlsFor(a.variantKeys);
      if (urls) out.set(r.userId, urls);
    }
    return out;
  }

  /** Erases all profile data for a user (age block, account purge). */
  /** What a shared profile link shows anyone (F-GRW-02): the name and badge; the photo only for public profiles. */
  async shareView(userId: string): Promise<PublicProfileView | null> {
    const [user, profile] = await Promise.all([this.users.findById(userId), this.get(userId)]);
    if (
      !user ||
      user.status !== 'active' ||
      !profile?.displayName ||
      !profile.onboardingCompletedAt
    )
      return null;
    const photo =
      profile.visibility === 'everyone'
        ? ((await this.primaryPhotos([userId])).get(userId) ?? null)
        : null;
    return {
      id: userId,
      displayName: profile.displayName,
      verified: user.verifiedAt !== null,
      photo,
    };
  }

  // ---------- moderation (F-SAF-06) ----------

  async moderationPreview(userId: string): Promise<ModerationPreview> {
    const profile = await this.get(userId);
    if (!profile) return GONE;
    const photo = (await this.primaryPhotos([userId])).get(userId) ?? null;
    const name = profile.displayName ?? '';
    return {
      title: name,
      text: profile.bio || null,
      image: photo,
      owner: { id: userId, displayName: name },
      gone: false,
    };
  }

  async releaseBio(userId: string, tx: Tx): Promise<AfterCommit> {
    await tx.update(profiles).set({ bioHeldAt: null }).where(eq(profiles.userId, userId));
    return undefined;
  }

  async removeBio(userId: string, tx: Tx): Promise<AfterCommit> {
    await tx.update(profiles).set({ bio: '', bioHeldAt: null }).where(eq(profiles.userId, userId));
    return undefined;
  }

  async erase(userId: string, tx: DbOrTx): Promise<string[]> {
    const photos = await tx
      .select({ id: profilePhotos.mediaAssetId })
      .from(profilePhotos)
      .where(eq(profilePhotos.userId, userId));
    await tx.delete(profilePhotos).where(eq(profilePhotos.userId, userId));
    await tx.delete(userInterests).where(eq(userInterests.userId, userId));
    await tx.delete(userVibeTags).where(eq(userVibeTags.userId, userId));
    await tx.delete(profiles).where(and(eq(profiles.userId, userId)));
    return photos.map((p) => p.id);
  }

  /** How many people picked each interest / vibe tag (admin taxonomy usage). */
  async taxonomyUsage(): Promise<Map<string, number>> {
    const res = await this.db.execute<{ id: string; n: number }>(sql`
      SELECT interest_id AS id, count(*)::int AS n FROM user_interests GROUP BY interest_id
      UNION ALL
      SELECT vibe_tag_id AS id, count(*)::int AS n FROM user_vibe_tags GROUP BY vibe_tag_id`);
    return new Map(res.rows.map((r) => [r.id, r.n]));
  }
}
