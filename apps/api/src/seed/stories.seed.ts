import { LIMITS } from '@touchgrass/shared';
import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { uuidv7 } from 'uuidv7';
import type { ObjectStorage } from '../adapters/storage/storage.port.js';
import type { Tx } from '../infra/database/database.module.js';
import { mediaAssets, stories, storyViews } from '../infra/database/schema/index.js';
import { renderVariant } from '../modules/media/media.processor.js';

export interface StoriesSeedSummary {
  /** Live stories posted by seeded members. */
  live: number;
}

const HOUR_MS = 3_600_000;
const COLOURS = ['#2F5D3A', '#C9F24D', '#1A5FD0', '#E8710A', '#7B3FD1'];
const CAPTIONS = ['Sunset at Durgam Cheruvu', 'Irani chai stop', '', 'Morning run done', ''];

/**
 * Phase 13 seed: squad stories for member #2 to open — three of their squad posted in the last few hours
 * (one already seen), plus one friend-of-friend story shared with "squad and their squads". Only when
 * storage is available (the images are real, generated files). Stories last 24 hours, so re-seeding
 * refills them once they have expired. Idempotent while they are live.
 */
export async function seedStories(
  tx: Tx,
  ctx: { memberIds: string[]; storage?: ObjectStorage },
  now: Date = new Date(),
): Promise<StoriesSeedSummary> {
  const viewer = ctx.memberIds[1];
  if (ctx.storage && viewer) {
    const storage = ctx.storage;
    const members = `{${ctx.memberIds.join(',')}}`;
    const squad = await tx.execute<{ id: string }>(sql`
      SELECT friend_id AS id FROM squad_edges
      WHERE user_id = ${viewer} AND friend_id = ANY(${members}::uuid[])
      ORDER BY friend_id LIMIT 3`);
    const fof = await tx.execute<{ id: string }>(sql`
      SELECT DISTINCT y.friend_id AS id
      FROM squad_edges x JOIN squad_edges y ON y.user_id = x.friend_id
      WHERE x.user_id = ${viewer} AND y.friend_id <> ${viewer} AND y.friend_id = ANY(${members}::uuid[])
        AND NOT EXISTS (SELECT 1 FROM squad_edges z WHERE z.user_id = ${viewer} AND z.friend_id = y.friend_id)
      ORDER BY y.friend_id LIMIT 1`);
    const authors = [
      ...squad.rows.map((r) => ({ id: r.id, audience: 'squad' as const })),
      ...fof.rows.map((r) => ({ id: r.id, audience: 'squad_fof' as const })),
    ];
    const live = await tx
      .select({ id: stories.id })
      .from(stories)
      .where(
        and(
          inArray(
            stories.authorId,
            authors.map((a) => a.id),
          ),
          eq(stories.status, 'live'),
          gt(stories.expiresAt, now),
        ),
      )
      .limit(1);
    if (live.length === 0 && authors.length > 0) {
      for (const [i, author] of authors.entries()) {
        const colour = COLOURS[i % COLOURS.length] as string;
        const svg = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350"><rect width="100%" height="100%" fill="${colour}"/><circle cx="540" cy="${String(500 + i * 80)}" r="260" fill="#ffffff" fill-opacity="0.22"/></svg>`,
        );
        const image = await sharp(svg).jpeg().toBuffer();
        const mediaId = uuidv7();
        const [sm, md, lg] = await Promise.all(
          LIMITS.imageSizes.map((s) => renderVariant(image, s)),
        );
        if (!sm || !md || !lg) continue;
        const keys = {
          sm: `media/${mediaId}/sm.webp`,
          md: `media/${mediaId}/md.webp`,
          lg: `media/${mediaId}/lg.webp`,
        };
        await Promise.all([
          storage.put(keys.sm, sm.buffer, 'image/webp'),
          storage.put(keys.md, md.buffer, 'image/webp'),
          storage.put(keys.lg, lg.buffer, 'image/webp'),
        ]);
        await tx.insert(mediaAssets).values({
          id: mediaId,
          ownerUserId: author.id,
          purpose: 'story',
          originalKey: `generated/${mediaId}`,
          contentType: 'image/webp',
          declaredBytes: lg.buffer.length,
          status: 'ready',
          width: lg.width,
          height: lg.height,
          variantKeys: keys,
          moderationLabels: [],
          processedAt: now,
        });
        const createdAt = new Date(now.getTime() - (i + 1) * HOUR_MS);
        const storyId = uuidv7();
        await tx.insert(stories).values({
          id: storyId,
          authorId: author.id,
          mediaId,
          caption: CAPTIONS[i % CAPTIONS.length] ?? '',
          audience: author.audience,
          createdAt,
          expiresAt: new Date(createdAt.getTime() + LIMITS.stories.lifetimeHours * HOUR_MS),
        });
        // Member #2 has already seen the oldest squad story, so the tray shows both rings.
        if (i === 2)
          await tx
            .insert(storyViews)
            .values({ storyId, viewerId: viewer, viewedAt: now })
            .onConflictDoNothing();
      }
    }
  }
  const res = await tx.execute<{ n: number }>(sql`
    SELECT count(*)::int AS n FROM stories
    WHERE status = 'live' AND expires_at > ${now} AND author_id = ANY(${`{${ctx.memberIds.join(',')}}`}::uuid[])`);
  return { live: res.rows[0]?.n ?? 0 };
}
