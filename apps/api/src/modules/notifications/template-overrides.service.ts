import { Inject, Injectable } from '@nestjs/common';
import {
  type NotificationCopy,
  type NotificationKind,
  NOTIFICATION_TEMPLATES,
  placeholdersOf,
  type SupportedLanguage,
  translate,
} from '@touchgrass/shared';
import { and, eq, sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { notificationTemplateOverrides } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { REDIS } from '../../infra/redis/redis.module.js';

const CACHE_PREFIX = 'cache:notification-overrides:v1:';
const GENERATION_KEY = 'cache:notification-overrides:generation';
const CACHE_TTL_SECONDS = 300;

export type OverrideMap = ReadonlyMap<string, NotificationCopy>;
export const overrideKey = (kind: string, lang: SupportedLanguage): string => `${kind}:${lang}`;

/** Placeholders a template may use in one language: whatever its default wording or link uses. */
export function allowedPlaceholders(kind: NotificationKind, lang: SupportedLanguage): string[] {
  const t = NOTIFICATION_TEMPLATES[kind];
  return [
    ...new Set([
      ...placeholdersOf(translate(t.title, lang)),
      ...placeholdersOf(translate(t.body, lang)),
      ...placeholdersOf(translate(t.title, 'en')),
      ...placeholdersOf(translate(t.body, 'en')),
      ...placeholdersOf(t.link),
    ]),
  ];
}

/**
 * Admin-edited notification wording (F-WEB-03 → F-NOT-01). Overrides replace a kind's default title and
 * body in one language; they may only use the placeholders that kind fills in. Cached per generation.
 */
@Injectable()
export class TemplateOverridesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  async all(): Promise<OverrideMap> {
    const generation = (await this.redis.get(GENERATION_KEY)) ?? '0';
    const key = `${CACHE_PREFIX}${generation}`;
    const cached = await this.redis.get(key);
    if (cached) return new Map(JSON.parse(cached) as [string, NotificationCopy][]);
    const rows = await this.db.select().from(notificationTemplateOverrides);
    const entries = rows.map(
      (r) =>
        [overrideKey(r.kind, r.language), { title: r.title, body: r.body }] as [
          string,
          NotificationCopy,
        ],
    );
    await this.redis.set(key, JSON.stringify(entries), 'EX', CACHE_TTL_SECONDS);
    return new Map(entries);
  }

  async set(
    kind: NotificationKind,
    lang: SupportedLanguage,
    copy: NotificationCopy,
    byUserId: string,
    tx: DbOrTx,
  ): Promise<void> {
    const allowed = allowedPlaceholders(kind, lang);
    const unknown = [...placeholdersOf(copy.title), ...placeholdersOf(copy.body)].filter(
      (p) => !allowed.includes(p),
    );
    if (unknown.length > 0)
      throw new AppError('VALIDATION_FAILED', `Unknown placeholder: ${unknown.join(', ')}`, [
        {
          path: 'body',
          message: `Use only ${allowed.join(', ') || 'no placeholders'}`,
          code: 'custom',
        },
      ]);
    await tx
      .insert(notificationTemplateOverrides)
      .values({ kind, language: lang, ...copy, updatedBy: byUserId })
      .onConflictDoUpdate({
        target: [notificationTemplateOverrides.kind, notificationTemplateOverrides.language],
        set: { ...copy, updatedBy: byUserId, updatedAt: sql`now()` },
      });
  }

  async clear(kind: NotificationKind, lang: SupportedLanguage, tx: DbOrTx): Promise<void> {
    await tx
      .delete(notificationTemplateOverrides)
      .where(
        and(
          eq(notificationTemplateOverrides.kind, kind),
          eq(notificationTemplateOverrides.language, lang),
        ),
      );
  }

  /** Call after the transaction commits. */
  async bump(): Promise<void> {
    await this.redis.incr(GENERATION_KEY);
  }
}
