import { hashPhoneE164 } from '@touchgrass/shared';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Database } from '../infra/database/database.module.js';
import {
  activityEvents,
  friendships,
  inviteCodes,
  profiles,
  userInterests,
  userRoles,
  users,
  userVibeTags,
} from '../infra/database/schema/index.js';
import { type ChatSeedSummary, seedChat } from './chat.seed.js';
import { type EventSeedSummary, seedEvents } from './events.seed.js';
import { type PaymentsSeedSummary, seedPayments } from './payments.seed.js';
import { type AfterSeedSummary, seedAfter } from './after.seed.js';
import { type EngagementSeedSummary, seedEngagement } from './engagement.seed.js';
import { type SafetySeedSummary, seedSafety } from './safety.seed.js';
import { type NotificationsSeedSummary, seedNotifications } from './notifications.seed.js';
import { type AdminConsoleSeedSummary, seedAdminConsole } from './admin-console.seed.js';
import { type StoriesSeedSummary, seedStories } from './stories.seed.js';
import type { ObjectStorage } from '../adapters/storage/storage.port.js';
import { seedReference } from './reference.js';
import { seedPersona } from './taxonomy.js';

export const SEED_ADMIN_PHONE = '+919000000001';
export const SEED_INVITE_CODE = 'GRASS-2026';
export const SEED_USER_COUNT = 200;

export interface SeedSummary {
  cities: number;
  neighbourhoods: number;
  featureFlags: number;
  interests: number;
  vibeTags: number;
  users: number;
  friendships: number;
  venues: number;
  events: number;
  rsvps: number;
  chat: ChatSeedSummary;
  payments: PaymentsSeedSummary;
  after: AfterSeedSummary;
  engagement: EngagementSeedSummary;
  safety: SafetySeedSummary;
  notifications: NotificationsSeedSummary;
  adminConsole: AdminConsoleSeedSummary;
  stories: StoriesSeedSummary;
}

/**
 * Idempotent development seed (fake data lives only here and in tests). Each phase extends it.
 * Dev sign-in: any seeded phone + OTP 000000 (non-production only). Admin: +91 90000 00001.
 */
export async function seed(
  db: Database,
  opts: { tokenPepper?: string; storage?: ObjectStorage } = {},
): Promise<SeedSummary> {
  return db.transaction(async (tx) => {
    const { cityId, hoodIds, interestIds, vibeIds } = await seedReference(tx);
    const city = { id: cityId };

    // Users: the dev super admin plus SEED_USER_COUNT onboarded Hyderabad residents.
    const upsertUser = async (
      phone: string,
      name: string,
      dob: string,
      gender: 'woman' | 'man' | 'non_binary',
      i: number,
    ): Promise<string> => {
      const [existing] = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.phoneHash, hashPhoneE164(phone)))
        .limit(1);
      const id = existing?.id ?? uuidv7();
      if (!existing) {
        await tx.insert(users).values({
          id,
          phoneE164: phone,
          phoneHash: hashPhoneE164(phone),
          status: 'active',
          language: 'en',
          cityId: city.id,
          verifiedAt: i % 3 === 0 ? new Date() : null,
        });
      }
      const now = new Date();
      await tx
        .insert(profiles)
        .values({
          userId: id,
          displayName: name,
          bio: '',
          dateOfBirth: dob,
          gender,
          cityId: city.id,
          neighbourhoodId: hoodIds[i % hoodIds.length] ?? null,
          spokenLanguages: i % 2 === 0 ? ['English', 'Telugu'] : ['English', 'Hindi'],
          onboardingCompletedAt: now,
          tutorialCompletedAt: now,
        })
        .onConflictDoNothing();
      const picks = [0, 1, 2, 3]
        .map((k) => interestIds[(i * 7 + k * 5) % interestIds.length])
        .filter((x): x is string => Boolean(x));
      await tx
        .insert(userInterests)
        .values([...new Set(picks)].map((interestId) => ({ userId: id, interestId })))
        .onConflictDoNothing();
      const vibe = vibeIds[i % vibeIds.length];
      if (vibe)
        await tx.insert(userVibeTags).values({ userId: id, vibeTagId: vibe }).onConflictDoNothing();
      return id;
    };

    const adminId = await upsertUser(
      SEED_ADMIN_PHONE,
      'Team TouchGrass',
      '1990-01-01',
      'non_binary',
      0,
    );
    await tx
      .insert(userRoles)
      .values({ id: uuidv7(), userId: adminId, role: 'super_admin', cityId: null })
      .onConflictDoNothing();
    await tx
      .insert(inviteCodes)
      .values({
        id: uuidv7(),
        code: SEED_INVITE_CODE,
        createdByUserId: adminId,
        source: 'admin',
        maxUses: 10_000,
        label: 'Development',
      })
      .onConflictDoNothing({ target: inviteCodes.code });
    const memberIds: string[] = [];
    for (let i = 1; i <= SEED_USER_COUNT; i += 1) {
      const p = seedPersona(i);
      memberIds.push(await upsertUser(p.phone, p.displayName, p.dob, p.gender, i));
    }

    // Squads: each member is friends with the next three (a ring), plus a pending request to the 5th;
    // the admin knows the first ten. Activity rows mirror what the worker would have written.
    const pair = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
    const befriend = async (
      a: string,
      b: string,
      status: 'accepted' | 'pending',
    ): Promise<void> => {
      const [low, high] = pair(a, b);
      const inserted = await tx
        .insert(friendships)
        .values({
          userLow: low,
          userHigh: high,
          requesterId: a,
          status,
          respondedAt: status === 'accepted' ? new Date() : null,
        })
        .onConflictDoNothing()
        .returning({ low: friendships.userLow });
      if (inserted.length > 0 && status === 'accepted') {
        await tx.insert(activityEvents).values({
          id: uuidv7(),
          actorId: b,
          subjectUserId: a,
          verb: 'squad_joined',
          sourceEventId: uuidv7(),
        });
      }
    };
    for (let i = 0; i < memberIds.length; i += 1) {
      const me = memberIds[i] as string;
      for (const k of [1, 2, 3])
        await befriend(me, memberIds[(i + k) % memberIds.length] as string, 'accepted');
      await befriend(me, memberIds[(i + 5) % memberIds.length] as string, 'pending');
    }
    for (const friendId of memberIds.slice(0, 10)) await befriend(adminId, friendId, 'accepted');

    const eventSummary: EventSeedSummary = await seedEvents(tx, {
      cityId: city.id,
      hoodIds,
      adminId,
      memberIds,
      interestIds,
      vibeIds,
    });

    const chatSummary = await seedChat(tx, { memberIds, adminId });
    const paymentsSummary = await seedPayments(tx, {
      cityId: city.id,
      memberIds,
      interestIds,
      tokenPepper: opts.tokenPepper,
    });
    const afterSummary = await seedAfter(tx, { storage: opts.storage });
    const engagementSummary = await seedEngagement(tx, {
      cityId: city.id,
      memberIds,
      interestIds,
      adminId,
    });
    const safetySummary = await seedSafety(tx, { memberIds, adminId, storage: opts.storage });
    const notificationsSummary = await seedNotifications(tx, { memberIds });
    const adminConsoleSummary = await seedAdminConsole(tx, { cityId: city.id, memberIds, adminId });
    const storiesSummary = await seedStories(tx, { memberIds, storage: opts.storage });

    const count = async (table: string): Promise<number> => {
      const res = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ${sql.identifier(table)}`,
      );
      return res.rows[0]?.n ?? 0;
    };
    return {
      cities: await count('cities'),
      neighbourhoods: await count('neighbourhoods'),
      featureFlags: await count('feature_flags'),
      interests: await count('interests'),
      vibeTags: await count('vibe_tags'),
      users: await count('users'),
      friendships: await count('friendships'),
      ...eventSummary,
      chat: chatSummary,
      payments: paymentsSummary,
      after: afterSummary,
      engagement: engagementSummary,
      safety: safetySummary,
      notifications: notificationsSummary,
      adminConsole: adminConsoleSummary,
      stories: storiesSummary,
    };
  });
}
