import { FEATURE_FLAG_DEFAULTS, hashPhoneE164, LIMITS } from '@touchgrass/shared';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { Tx } from '../infra/database/database.module.js';
import {
  appSettings,
  cities,
  featureFlags,
  interests,
  neighbourhoods,
  profiles,
  userRoles,
  users,
  vibeTags,
} from '../infra/database/schema/index.js';
import { seedIcebreakerDeck } from './chat.seed.js';
import { boxAround, HYDERABAD, HYDERABAD_NEIGHBOURHOODS } from './hyderabad.js';
import { INTERESTS, VIBE_TAGS } from './taxonomy.js';

export interface ReferenceIds {
  cityId: string;
  hoodIds: string[];
  interestIds: string[];
  vibeIds: string[];
}

/**
 * Reference data every environment needs, production included: the launch city and its neighbourhoods,
 * feature flags at their defaults, app settings, the interest and vibe taxonomy, and the starter icebreaker
 * deck. Idempotent; never overwrites a flag or setting an admin has changed. No people, no plans.
 */
export async function seedReference(tx: Tx): Promise<ReferenceIds> {
  const [city] = await tx
    .insert(cities)
    .values({ id: uuidv7(), ...HYDERABAD })
    .onConflictDoUpdate({
      target: cities.slug,
      set: {
        name: HYDERABAD.name,
        launchStatus: HYDERABAD.launchStatus,
        languages: HYDERABAD.languages,
      },
    })
    .returning({ id: cities.id });
  if (!city) throw new Error('Failed to upsert Hyderabad');

  const hoodIds: string[] = [];
  for (const n of HYDERABAD_NEIGHBOURHOODS) {
    const [row] = await tx
      .insert(neighbourhoods)
      .values({
        id: uuidv7(),
        cityId: city.id,
        slug: n.slug,
        name: n.name,
        centroid: n.centroid,
        boundary: boxAround(n.centroid, 0.012, 0.014),
      })
      .onConflictDoUpdate({
        target: [neighbourhoods.cityId, neighbourhoods.slug],
        set: { name: n.name },
      })
      .returning({ id: neighbourhoods.id });
    if (row) hoodIds.push(row.id);
  }

  for (const [key, enabled] of Object.entries(FEATURE_FLAG_DEFAULTS)) {
    await tx
      .insert(featureFlags)
      .values({ id: uuidv7(), key, enabled })
      .onConflictDoNothing({ target: featureFlags.key });
  }
  await tx
    .insert(appSettings)
    .values({ key: 'invites_per_user', value: LIMITS.invites.defaultPerUser })
    .onConflictDoNothing();

  const interestIds: string[] = [];
  for (const [i, it] of INTERESTS.entries()) {
    const [row] = await tx
      .insert(interests)
      .values({
        id: uuidv7(),
        slug: it.slug,
        emoji: it.emoji,
        category: it.category,
        sortOrder: i,
        name: { en: it.en, te: it.te, hi: it.hi },
      })
      .onConflictDoUpdate({
        target: interests.slug,
        set: {
          name: { en: it.en, te: it.te, hi: it.hi },
          emoji: it.emoji,
          category: it.category,
          sortOrder: i,
        },
      })
      .returning({ id: interests.id });
    if (row) interestIds.push(row.id);
  }
  const vibeIds: string[] = [];
  for (const [i, v] of VIBE_TAGS.entries()) {
    const [row] = await tx
      .insert(vibeTags)
      .values({
        id: uuidv7(),
        slug: v.slug,
        emoji: v.emoji,
        sortOrder: i,
        name: { en: v.en, te: v.te, hi: v.hi },
      })
      .onConflictDoUpdate({
        target: vibeTags.slug,
        set: { name: { en: v.en, te: v.te, hi: v.hi }, emoji: v.emoji, sortOrder: i },
      })
      .returning({ id: vibeTags.id });
    if (row) vibeIds.push(row.id);
  }

  await seedIcebreakerDeck(tx);
  return { cityId: city.id, hoodIds, interestIds, vibeIds };
}

/**
 * Makes the owner of this phone number a super admin, creating the account (still onboarding) if they
 * haven't signed up yet. How the first admin gets in on a fresh production database, where the invite gate
 * is on and nobody can hand out invites yet. Returns the user id and whether the account was created.
 */
export async function grantSuperAdmin(
  tx: Tx,
  phoneE164: string,
): Promise<{ userId: string; created: boolean }> {
  const [existing] = await tx
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.phoneHash, hashPhoneE164(phoneE164)))
    .limit(1);
  if (existing && existing.status !== 'active' && existing.status !== 'onboarding')
    throw new Error(`That account is ${existing.status}; it can't be made an admin`);
  let userId = existing?.id;
  if (!userId) {
    userId = uuidv7();
    await tx.insert(users).values({
      id: userId,
      phoneE164,
      phoneHash: hashPhoneE164(phoneE164),
      status: 'onboarding',
      language: 'en',
    });
    await tx.insert(profiles).values({ userId }).onConflictDoNothing();
  }
  await tx
    .insert(userRoles)
    .values({ id: uuidv7(), userId, role: 'super_admin', cityId: null })
    .onConflictDoNothing();
  return { userId, created: !existing };
}
