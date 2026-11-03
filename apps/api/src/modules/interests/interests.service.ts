import { Inject, Injectable } from '@nestjs/common';
import type { Interest, UpsertInterestBody, UpsertVibeTagBody, VibeTag } from '@touchgrass/shared';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { Snapshot } from '../../common/cache/snapshot.js';
import { AppError } from '../../common/errors/app-error.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { interests, vibeTags } from '../../infra/database/schema/index.js';

const toInterest = (r: typeof interests.$inferSelect): Interest => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  emoji: r.emoji,
  category: r.category,
});
const toVibe = (r: typeof vibeTags.$inferSelect): VibeTag => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  emoji: r.emoji,
});

/** Admin-managed taxonomy: interests and vibe tags (F-EVT-11). */
@Injectable()
export class InterestsService {
  /** Plans and profiles look taxonomy up on every read; the tables are small and admin-edited. */
  private readonly catalog = new Snapshot(
    async () => ({
      interests: new Map((await this.db.select().from(interests)).map((r) => [r.id, r])),
      vibeTags: new Map((await this.db.select().from(vibeTags)).map((r) => [r.id, r])),
    }),
    60_000,
  );

  constructor(@Inject(DB) private readonly db: Database) {}

  async listInterests(): Promise<Interest[]> {
    return (
      await this.db
        .select()
        .from(interests)
        .where(eq(interests.active, true))
        .orderBy(asc(interests.sortOrder), asc(interests.slug))
    ).map(toInterest);
  }

  async listVibeTags(): Promise<VibeTag[]> {
    return (
      await this.db
        .select()
        .from(vibeTags)
        .where(eq(vibeTags.active, true))
        .orderBy(asc(vibeTags.sortOrder), asc(vibeTags.slug))
    ).map(toVibe);
  }

  async interestsByIds(ids: string[]): Promise<Interest[]> {
    if (ids.length === 0) return [];
    const { interests: all } = await this.catalog.get();
    return [...new Set(ids)]
      .flatMap((id) => {
        const row = all.get(id);
        return row ? [row] : [];
      })
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toInterest);
  }

  async vibeTagsByIds(ids: string[]): Promise<VibeTag[]> {
    if (ids.length === 0) return [];
    const { vibeTags: all } = await this.catalog.get();
    return [...new Set(ids)]
      .flatMap((id) => {
        const row = all.get(id);
        return row ? [row] : [];
      })
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(toVibe);
  }

  /** True only when every id refers to an active interest. */
  async allActiveInterests(ids: string[]): Promise<boolean> {
    const unique = [...new Set(ids)];
    const rows = await this.db
      .select({ id: interests.id })
      .from(interests)
      .where(and(inArray(interests.id, unique), eq(interests.active, true)));
    return rows.length === unique.length;
  }

  async allActiveVibeTags(ids: string[]): Promise<boolean> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return true;
    const rows = await this.db
      .select({ id: vibeTags.id })
      .from(vibeTags)
      .where(and(inArray(vibeTags.id, unique), eq(vibeTags.active, true)));
    return rows.length === unique.length;
  }
  // ---------- admin (F-WEB-03: vibe tags and interests) ----------

  /** Everything, active or not, in display order. */
  async adminAll(): Promise<{
    interests: (typeof interests.$inferSelect)[];
    vibeTags: (typeof vibeTags.$inferSelect)[];
  }> {
    const [i, v] = await Promise.all([
      this.db.select().from(interests).orderBy(asc(interests.sortOrder), asc(interests.slug)),
      this.db.select().from(vibeTags).orderBy(asc(vibeTags.sortOrder), asc(vibeTags.slug)),
    ]);
    return { interests: i, vibeTags: v };
  }

  async upsertInterest(id: string | null, body: UpsertInterestBody, db: DbOrTx): Promise<string> {
    const [clash] = await db
      .select({ id: interests.id })
      .from(interests)
      .where(eq(interests.slug, body.slug))
      .limit(1);
    if (clash && clash.id !== id)
      throw new AppError('CONFLICT', 'Another interest uses that slug', { reason: 'SLUG_TAKEN' });
    if (id === null) {
      const newId = uuidv7();
      await db.insert(interests).values({ id: newId, ...body });
      this.catalog.invalidate();
      return newId;
    }
    const updated = await db
      .update(interests)
      .set(body)
      .where(eq(interests.id, id))
      .returning({ id: interests.id });
    if (updated.length === 0) throw AppError.notFound('Interest');
    this.catalog.invalidate();
    return id;
  }

  async upsertVibeTag(id: string | null, body: UpsertVibeTagBody, db: DbOrTx): Promise<string> {
    const [clash] = await db
      .select({ id: vibeTags.id })
      .from(vibeTags)
      .where(eq(vibeTags.slug, body.slug))
      .limit(1);
    if (clash && clash.id !== id)
      throw new AppError('CONFLICT', 'Another vibe tag uses that slug', { reason: 'SLUG_TAKEN' });
    if (id === null) {
      const newId = uuidv7();
      await db.insert(vibeTags).values({ id: newId, ...body });
      this.catalog.invalidate();
      return newId;
    }
    const updated = await db
      .update(vibeTags)
      .set(body)
      .where(eq(vibeTags.id, id))
      .returning({ id: vibeTags.id });
    if (updated.length === 0) throw AppError.notFound('Vibe tag');
    this.catalog.invalidate();
    return id;
  }
}
