import { GREAT_TAGS, IMPROVE_TAGS, LIMITS, reliabilityOutcome } from '@touchgrass/shared';
import { eq, sql } from 'drizzle-orm';
import sharp from 'sharp';
import { uuidv7 } from 'uuidv7';
import type { ObjectStorage } from '../adapters/storage/storage.port.js';
import type { Tx } from '../infra/database/database.module.js';
import {
  eventFeedback,
  hostRatings,
  loreAlbums,
  loreItems,
  mediaAssets,
  reconnectPulls,
  reliabilityEvents,
  reliabilityScores,
} from '../infra/database/schema/index.js';
import { renderVariant } from '../modules/media/media.processor.js';
import { OutboxService } from '../infra/outbox/outbox.service.js';
import { LORE_CHANGED_EVENT } from '../modules/lore/lore.service.js';

export interface AfterSeedSummary {
  feedback: number;
  hostRatings: number;
  reliabilityScores: number;
  loreItems: number;
}

const COMMENTS = [
  'Loved it. Would come again!',
  'Great people, a bit hard to find the spot.',
  'Started late but the vibe was worth it.',
  'Please do this every month.',
];
const COLOURS = ['#1E8E3E', '#1A5FD0', '#E8710A', '#D01884', '#7B3FD1', '#00897B'];

/**
 * Phase 7 seed: feedback and host ratings on finished seeded plans, reliability computed from seeded
 * attendance (same scoring as the worker), a few reconnect pulls, and — when storage is available — Lore
 * albums with generated photos for five recent plans. Idempotent.
 */
export async function seedAfter(
  tx: Tx,
  ctx: { storage?: ObjectStorage },
  now: Date = new Date(),
): Promise<AfterSeedSummary> {
  // Who attended which finished seeded plan, and who hosted it.
  const attended = await tx.execute<{
    event_id: string;
    user_id: string;
    host_id: string;
    n: number;
  }>(sql`
    SELECT r.event_id, r.user_id, e.creator_user_id AS host_id,
      row_number() OVER (PARTITION BY r.event_id ORDER BY r.user_id)::int AS n
    FROM rsvps r JOIN events e ON e.id = r.event_id
    WHERE e.status = 'completed' AND (e.slug LIKE 'seedev%' OR e.slug LIKE 'seedpd%')
      AND r.status = 'checked_in' AND r.user_id <> e.creator_user_id`);
  for (const a of attended.rows) {
    if (a.n % 4 === 0) continue; // not everyone leaves feedback
    const rating = 3 + (a.n % 3);
    await tx
      .insert(eventFeedback)
      .values({
        eventId: a.event_id,
        userId: a.user_id,
        rating,
        great: [GREAT_TAGS[a.n % GREAT_TAGS.length] as string],
        improve: rating < 5 ? [IMPROVE_TAGS[a.n % IMPROVE_TAGS.length] as string] : [],
        comment: a.n % 3 === 0 ? (COMMENTS[a.n % COMMENTS.length] as string) : '',
      })
      .onConflictDoNothing();
    await tx
      .insert(hostRatings)
      .values({
        eventId: a.event_id,
        raterId: a.user_id,
        hostUserId: a.host_id,
        rating: Math.min(5, rating + 1),
      })
      .onConflictDoNothing();
  }

  // Reliability ledger from seeded attendance, then scores with the shared scoring.
  await tx.execute(sql`
    INSERT INTO reliability_events (user_id, event_id, kind, at)
    SELECT r.user_id, r.event_id, 'check_in', coalesce(r.checked_in_at, e.starts_at)
    FROM rsvps r JOIN events e ON e.id = r.event_id
    WHERE e.status = 'completed' AND r.status = 'checked_in'
      AND NOT EXISTS (SELECT 1 FROM event_hosts h WHERE h.event_id = r.event_id AND h.user_id = r.user_id)
    UNION ALL
    SELECT r.user_id, r.event_id, 'no_show', e.starts_at
    FROM rsvps r JOIN events e ON e.id = r.event_id
    WHERE e.status = 'completed' AND r.status = 'going'
      AND NOT EXISTS (SELECT 1 FROM event_hosts h WHERE h.event_id = r.event_id AND h.user_id = r.user_id)
    UNION ALL
    SELECT r.user_id, r.event_id, 'late_cancel', coalesce(r.cancelled_at, e.starts_at)
    FROM rsvps r JOIN events e ON e.id = r.event_id
    WHERE r.status = 'cancelled' AND r.late_cancel
    ON CONFLICT DO NOTHING`);
  const ledger = await tx.select().from(reliabilityEvents);
  const byUser = new Map<string, { kind: 'check_in' | 'no_show' | 'late_cancel'; at: Date }[]>();
  for (const l of ledger)
    byUser.set(l.userId, [...(byUser.get(l.userId) ?? []), { kind: l.kind, at: l.at }]);
  for (const [userId, events] of byUser) {
    const o = reliabilityOutcome(events, now);
    await tx
      .insert(reliabilityScores)
      .values({
        userId,
        score: o.score,
        tier: o.tier,
        noShowsRecent: o.noShowsRecent,
        cooldownUntil: o.cooldownUntil,
        computedAt: now,
      })
      .onConflictDoUpdate({
        target: reliabilityScores.userId,
        set: {
          score: o.score,
          tier: o.tier,
          noShowsRecent: o.noShowsRecent,
          cooldownUntil: o.cooldownUntil,
          computedAt: now,
        },
      });
  }

  // A few one-sided pulls so "pulled you" shows up.
  for (const a of attended.rows.filter((r) => r.n === 1)) {
    const other = attended.rows.find((r) => r.event_id === a.event_id && r.n === 2);
    if (other)
      await tx
        .insert(reconnectPulls)
        .values({ eventId: a.event_id, fromUserId: a.user_id, toUserId: other.user_id })
        .onConflictDoNothing();
  }

  // Lore: three generated photos for each of the five most recent finished seeded plans.
  if (ctx.storage) {
    const storage = ctx.storage;
    const recent = await tx.execute<{ id: string; title: string }>(sql`
      SELECT id, title FROM events WHERE status = 'completed' AND slug LIKE 'seedev%'
      ORDER BY ends_at DESC LIMIT 5`);
    for (const [i, ev] of recent.rows.entries()) {
      const [has] = await tx
        .select({ id: loreItems.id })
        .from(loreItems)
        .where(eq(loreItems.eventId, ev.id))
        .limit(1);
      if (has) continue;
      const uploaders = attended.rows.filter((r) => r.event_id === ev.id).slice(0, 3);
      await tx.insert(loreAlbums).values({ eventId: ev.id }).onConflictDoNothing();
      for (const [j, u] of uploaders.entries()) {
        const colour = COLOURS[(i + j) % COLOURS.length] as string;
        const svg = Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="900"><rect width="100%" height="100%" fill="${colour}"/><circle cx="${String(300 + j * 300)}" cy="420" r="180" fill="#ffffff" fill-opacity="0.25"/></svg>`,
        );
        const image = await sharp(svg).jpeg().toBuffer();
        const id = uuidv7();
        const [sm, md, lg] = await Promise.all(
          LIMITS.imageSizes.map((s) => renderVariant(image, s)),
        );
        if (!sm || !md || !lg) continue;
        const keys = {
          sm: `media/${id}/sm.webp`,
          md: `media/${id}/md.webp`,
          lg: `media/${id}/lg.webp`,
        };
        await Promise.all([
          storage.put(keys.sm, sm.buffer, 'image/webp'),
          storage.put(keys.md, md.buffer, 'image/webp'),
          storage.put(keys.lg, lg.buffer, 'image/webp'),
        ]);
        await tx.insert(mediaAssets).values({
          id,
          ownerUserId: u.user_id,
          purpose: 'lore',
          originalKey: `generated/${id}`,
          contentType: 'image/webp',
          declaredBytes: lg.buffer.length,
          status: 'ready',
          width: lg.width,
          height: lg.height,
          variantKeys: keys,
          moderationLabels: [],
          processedAt: now,
        });
        await tx.insert(loreItems).values({
          id: uuidv7(),
          eventId: ev.id,
          mediaId: id,
          uploaderId: u.user_id,
          caption: j === 0 ? `${ev.title} 🌿` : '',
        });
      }
      // The worker draws the album's collage cover, exactly as after a real upload.
      if (uploaders.length > 0)
        await new OutboxService().add(tx, {
          aggregateType: 'event',
          aggregateId: ev.id,
          type: LORE_CHANGED_EVENT,
          payload: { eventId: ev.id },
        });
    }
  }

  // Counts what belongs to seeded plans, so rows people (or tests) add on their own plans don't skew it.
  const res = await tx.execute<Record<keyof AfterSeedSummary, number>>(sql`
    WITH seeded AS (
      SELECT id FROM events WHERE slug LIKE 'seedev%' OR slug LIKE 'seedpd%'
    )
    SELECT (SELECT count(*)::int FROM event_feedback WHERE event_id IN (SELECT id FROM seeded)) AS feedback,
           (SELECT count(*)::int FROM host_ratings WHERE event_id IN (SELECT id FROM seeded)) AS "hostRatings",
           (SELECT count(*)::int FROM reliability_scores) AS "reliabilityScores",
           (SELECT count(*)::int FROM lore_items WHERE event_id IN (SELECT id FROM seeded)) AS "loreItems"`);
  const row = res.rows[0];
  return {
    feedback: row?.feedback ?? 0,
    hostRatings: row?.hostRatings ?? 0,
    reliabilityScores: row?.reliabilityScores ?? 0,
    loreItems: row?.loreItems ?? 0,
  };
}
