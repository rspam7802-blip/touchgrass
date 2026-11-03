import { Inject, Injectable } from '@nestjs/common';
import { FEATURE_FLAG_DEFAULTS, type FeatureFlagKey } from '@touchgrass/shared';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { uuidv7 } from 'uuidv7';
import { DB, type Database } from '../../infra/database/database.module.js';
import { featureFlags } from '../../infra/database/schema/index.js';
import { REDIS } from '../../infra/redis/redis.module.js';

const CACHE_PREFIX = 'cache:feature-flags:v2:';
const GENERATION_KEY = 'cache:feature-flags:generation';
const CACHE_TTL_SECONDS = 30;

/**
 * DB-backed feature flags (F-PLT-01), cached in Redis. Writes bump a generation counter and the cache
 * is keyed by generation, so a reader that loaded the old rows before a write committed can only fill
 * a key nobody reads any more (a plain delete would let it re-cache the stale value).
 */
@Injectable()
export class FeatureFlagsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async all(): Promise<Record<string, boolean>> {
    const generation = (await this.redis.get(GENERATION_KEY)) ?? '0';
    const cacheKey = `${CACHE_PREFIX}${generation}`;
    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as Record<string, boolean>;
    const rows = await this.db
      .select({ key: featureFlags.key, enabled: featureFlags.enabled })
      .from(featureFlags);
    const flags: Record<string, boolean> = { ...FEATURE_FLAG_DEFAULTS };
    for (const row of rows) flags[row.key] = row.enabled;
    await this.redis.set(cacheKey, JSON.stringify(flags), 'EX', CACHE_TTL_SECONDS);
    return flags;
  }

  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    const flags = await this.all();
    return flags[key] ?? FEATURE_FLAG_DEFAULTS[key];
  }

  async set(key: string, enabled: boolean, description?: string): Promise<void> {
    await this.db
      .insert(featureFlags)
      .values({ id: uuidv7(), key, enabled, description: description ?? '' })
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: {
          enabled,
          description: description === undefined ? sql`${featureFlags.description}` : description,
        },
      });
    await this.redis.incr(GENERATION_KEY);
  }
}
