import { LIMITS } from '@touchgrass/shared';
import { eq, inArray, isNull } from 'drizzle-orm';
import sharp from 'sharp';
import { uuidv7 } from 'uuidv7';
import type { ObjectStorage } from '../adapters/storage/storage.port.js';
import type { Tx } from '../infra/database/database.module.js';
import {
  crews,
  events,
  interests,
  mediaAssets,
  profilePhotos,
  type VariantKeys,
} from '../infra/database/schema/index.js';
import { renderVariant } from '../modules/media/media.processor.js';
import { avatarSvg, coverSvg, hashText } from './art.js';

export interface MediaSeedSummary {
  planCovers: number;
  crewCovers: number;
  profilePhotos: number;
}

interface Rendered {
  sm: Buffer;
  md: Buffer;
  lg: Buffer;
  width: number;
  height: number;
}

/** Renders art into the three webp sizes once per design; plans and people share a pool of designs. */
async function render(
  cache: Map<string, Promise<Rendered | null>>,
  key: string,
  svg: () => Buffer,
) {
  let hit = cache.get(key);
  if (!hit) {
    hit = (async () => {
      const image = await sharp(svg()).jpeg({ quality: 88 }).toBuffer();
      const [sm, md, lg] = await Promise.all(
        LIMITS.imageSizes.map((size) => renderVariant(image, size)),
      );
      if (!sm || !md || !lg) return null;
      return { sm: sm.buffer, md: md.buffer, lg: lg.buffer, width: lg.width, height: lg.height };
    })();
    cache.set(key, hit);
  }
  return hit;
}

/** Stores rendered art as its own ready asset (own files), like an upload after processing. */
async function storeArt(
  tx: Tx,
  storage: ObjectStorage,
  art: Rendered,
  purpose: 'event_cover' | 'profile_photo',
  ownerUserId: string | null,
  now: Date,
): Promise<string> {
  const id = uuidv7();
  const keys: VariantKeys = {
    sm: `media/${id}/sm.webp`,
    md: `media/${id}/md.webp`,
    lg: `media/${id}/lg.webp`,
  };
  await Promise.all([
    storage.put(keys.sm, art.sm, 'image/webp'),
    storage.put(keys.md, art.md, 'image/webp'),
    storage.put(keys.lg, art.lg, 'image/webp'),
  ]);
  await tx.insert(mediaAssets).values({
    id,
    ownerUserId,
    purpose,
    originalKey: `generated/${id}`,
    contentType: 'image/webp',
    declaredBytes: art.lg.length,
    status: 'ready',
    width: art.width,
    height: art.height,
    variantKeys: keys,
    moderationLabels: [],
    processedAt: now,
  });
  return id;
}

/** Three looks per category icon and 24 profile pictures: varied enough on screen, fast to seed. */
const COVER_LOOKS = 3;
const AVATAR_LOOKS = 24;

/**
 * Pictures for the demo data: a cover for every plan and crew that has none, drawn for its category, and a
 * profile picture for every seeded person without one. Idempotent (only fills what is missing); skipped when
 * no storage is configured.
 */
export async function seedMedia(
  tx: Tx,
  opts: { storage?: ObjectStorage; userIds: string[] },
): Promise<MediaSeedSummary> {
  const summary: MediaSeedSummary = { planCovers: 0, crewCovers: 0, profilePhotos: 0 };
  const { storage } = opts;
  if (!storage) return summary;
  const now = new Date();
  const cache = new Map<string, Promise<Rendered | null>>();

  const planRows = await tx
    .select({ id: events.id, slug: interests.slug, category: interests.category })
    .from(events)
    .leftJoin(interests, eq(interests.id, events.categoryInterestId))
    .where(isNull(events.coverMediaId));
  for (const plan of planRows) {
    const look = hashText(plan.id) % COVER_LOOKS;
    const art = await render(cache, `cover:${plan.slug ?? ''}:${String(look)}`, () =>
      coverSvg(plan.category, plan.slug, look * 7919 + 13),
    );
    if (!art) continue;
    const mediaId = await storeArt(tx, storage, art, 'event_cover', null, now);
    await tx.update(events).set({ coverMediaId: mediaId }).where(eq(events.id, plan.id));
    summary.planCovers += 1;
  }

  const crewRows = await tx
    .select({
      id: crews.id,
      createdBy: crews.createdBy,
      slug: interests.slug,
      category: interests.category,
    })
    .from(crews)
    .leftJoin(interests, eq(interests.id, crews.interestId))
    .where(isNull(crews.coverMediaId));
  for (const crew of crewRows) {
    const look = hashText(crew.id) % COVER_LOOKS;
    const art = await render(cache, `cover:${crew.slug ?? ''}:${String(look)}`, () =>
      coverSvg(crew.category, crew.slug, look * 7919 + 13),
    );
    if (!art) continue;
    const mediaId = await storeArt(tx, storage, art, 'event_cover', crew.createdBy, now);
    await tx.update(crews).set({ coverMediaId: mediaId }).where(eq(crews.id, crew.id));
    summary.crewCovers += 1;
  }

  if (opts.userIds.length > 0) {
    const withPhoto = new Set(
      (
        await tx
          .select({ userId: profilePhotos.userId })
          .from(profilePhotos)
          .where(inArray(profilePhotos.userId, opts.userIds))
      ).map((r) => r.userId),
    );
    for (const userId of opts.userIds) {
      if (withPhoto.has(userId)) continue;
      const look = hashText(userId) % AVATAR_LOOKS;
      const art = await render(cache, `avatar:${String(look)}`, () => avatarSvg(look * 977 + 5));
      if (!art) continue;
      const mediaId = await storeArt(tx, storage, art, 'profile_photo', userId, now);
      await tx
        .insert(profilePhotos)
        .values({ id: uuidv7(), userId, mediaAssetId: mediaId, position: 0 }); // only people without a photo get here
      summary.profilePhotos += 1;
    }
  }
  return summary;
}
