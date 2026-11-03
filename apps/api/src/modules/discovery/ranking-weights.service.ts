import { Inject, Injectable } from '@nestjs/common';
import {
  DEFAULT_RANKING_WEIGHTS,
  RANKING_WEIGHT_KEYS,
  type RankingWeights,
  type RankingWeightValues,
} from '@touchgrass/shared';
import { desc, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { DB, type Database } from '../../infra/database/database.module.js';
import { rankingWeights } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { REDIS } from '../../infra/redis/redis.module.js';

const CACHE_PREFIX = 'cache:ranking-weights:v1:';
const GENERATION_KEY = 'cache:ranking-weights:generation';
const CACHE_TTL_SECONDS = 60;

/**
 * Admin-tuned discovery weights (F-WEB-03 → F-DSC-07). Missing keys use the shared defaults. Cached per
 * generation like feature flags (D-117), so a write is never undone by a reader that loaded old rows.
 */
@Injectable()
export class RankingWeightsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async current(): Promise<RankingWeightValues> {
    const generation = (await this.redis.get(GENERATION_KEY)) ?? '0';
    const key = `${CACHE_PREFIX}${generation}`;
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached) as RankingWeightValues;
    const out: RankingWeightValues = { ...DEFAULT_RANKING_WEIGHTS };
    for (const row of await this.db.select().from(rankingWeights)) {
      if ((RANKING_WEIGHT_KEYS as string[]).includes(row.key))
        out[row.key as keyof RankingWeightValues] = row.value;
    }
    await this.redis.set(key, JSON.stringify(out), 'EX', CACHE_TTL_SECONDS);
    return out;
  }

  async view(): Promise<RankingWeights> {
    const [latest] = await this.db
      .select({ at: rankingWeights.updatedAt })
      .from(rankingWeights)
      .orderBy(desc(rankingWeights.updatedAt))
      .limit(1);
    return {
      weights: await this.current(),
      defaults: { ...DEFAULT_RANKING_WEIGHTS },
      updatedAt: latest?.at.toISOString() ?? null,
    };
  }

  /** Saves every weight (call inside the audit transaction), then moves readers to a new generation. */
  async save(values: RankingWeightValues, byUserId: string, tx: DbOrTx): Promise<void> {
    for (const key of RANKING_WEIGHT_KEYS) {
      await tx
        .insert(rankingWeights)
        .values({ key, value: values[key], updatedBy: byUserId })
        .onConflictDoUpdate({
          target: rankingWeights.key,
          set: { value: values[key], updatedBy: byUserId, updatedAt: sql`now()` },
        });
    }
  }

  async reset(tx: DbOrTx): Promise<void> {
    await tx.delete(rankingWeights);
  }

  /** Call after the transaction commits. */
  async bump(): Promise<void> {
    await this.redis.incr(GENERATION_KEY);
  }
}
