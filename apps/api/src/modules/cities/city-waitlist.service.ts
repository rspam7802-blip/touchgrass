import { Inject, Injectable } from '@nestjs/common';
import type { CityWaitlistStatus, JoinCityWaitlistBody } from '@touchgrass/shared';
import { and, count, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error.js';
import { DB, type Database, type Tx } from '../../infra/database/database.module.js';
import { cityWaitlist } from '../../infra/database/schema/index.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { OutboxService } from '../../infra/outbox/outbox.service.js';
import { CitiesService } from './cities.service.js';

export const CITY_WAITLIST_JOINED_EVENT = 'city.waitlist_joined';
export const CITY_LAUNCHED_EVENT = 'city.launched';

/** "Vizag", " vizag " and "VIZAG" are one request. */
export function normalizeCityName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * City waitlist (F-GRW-03): people whose city isn't open yet join its list (or name a place that isn't a
 * city on TouchGrass yet). One entry per person; opening a city tells everyone waiting for it.
 */
@Injectable()
export class CityWaitlistService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly cities: CitiesService,
    private readonly outbox: OutboxService,
  ) {}

  async join(userId: string, body: JoinCityWaitlistBody): Promise<CityWaitlistStatus> {
    let target: {
      cityId: string | null;
      requestedName: string | null;
      normalizedName: string | null;
    };
    if ('cityId' in body) {
      const city = await this.cities.byId(body.cityId);
      if (!city) throw AppError.notFound('City');
      if (city.launchStatus !== 'waitlist')
        throw new AppError('CONFLICT', `${city.name} is already open`, { reason: 'CITY_OPEN' });
      target = { cityId: city.id, requestedName: null, normalizedName: null };
    } else {
      target = {
        cityId: null,
        requestedName: body.cityName.trim().replace(/\s+/g, ' '),
        normalizedName: normalizeCityName(body.cityName),
      };
    }
    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select()
        .from(cityWaitlist)
        .where(eq(cityWaitlist.userId, userId))
        .for('update');
      const same =
        before !== undefined &&
        before.cityId === target.cityId &&
        before.normalizedName === target.normalizedName;
      if (same) return;
      // Changing your mind puts you at the back of the new queue.
      await tx
        .insert(cityWaitlist)
        .values({ userId, ...target })
        .onConflictDoUpdate({
          target: cityWaitlist.userId,
          set: { ...target, notifiedAt: null, createdAt: sql`now()`, updatedAt: sql`now()` },
        });
      await this.outbox.add(tx, {
        aggregateType: 'user',
        aggregateId: userId,
        type: CITY_WAITLIST_JOINED_EVENT,
        payload: { userId, cityId: target.cityId },
      });
    });
    return this.status(userId);
  }

  async status(userId: string): Promise<CityWaitlistStatus> {
    const [row] = await this.db.select().from(cityWaitlist).where(eq(cityWaitlist.userId, userId));
    if (!row)
      return { joined: false, cityId: null, cityName: null, position: null, joinedAt: null };
    const ahead = await this.db
      .select({ n: count() })
      .from(cityWaitlist)
      .where(
        and(
          row.cityId
            ? eq(cityWaitlist.cityId, row.cityId)
            : and(
                isNull(cityWaitlist.cityId),
                eq(cityWaitlist.normalizedName, row.normalizedName ?? ''),
              ),
          or(
            lt(cityWaitlist.createdAt, row.createdAt),
            and(eq(cityWaitlist.createdAt, row.createdAt), lt(cityWaitlist.userId, row.userId)),
          ),
        ),
      );
    const city = row.cityId ? await this.cities.byId(row.cityId) : null;
    return {
      joined: true,
      cityId: row.cityId,
      cityName: city?.name ?? row.requestedName,
      position: (ahead[0]?.n ?? 0) + 1,
      joinedAt: row.createdAt.toISOString(),
    };
  }

  async leave(userId: string, db: DbOrTx = this.db): Promise<void> {
    await db.delete(cityWaitlist).where(eq(cityWaitlist.userId, userId));
  }

  /** People waiting per city id, for the admin list. */
  async countsByCity(): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ cityId: cityWaitlist.cityId, n: count() })
      .from(cityWaitlist)
      .where(isNotNull(cityWaitlist.cityId))
      .groupBy(cityWaitlist.cityId);
    return new Map(rows.flatMap((r) => (r.cityId ? [[r.cityId, r.n] as const] : [])));
  }

  /** Places asked for that aren't cities yet, most requested first. */
  async requested(limit = 20): Promise<{ name: string; count: number }[]> {
    const rows = await this.db
      .select({
        name: sql<string>`min(${cityWaitlist.requestedName})`,
        n: count(),
      })
      .from(cityWaitlist)
      .where(isNull(cityWaitlist.cityId))
      .groupBy(cityWaitlist.normalizedName)
      .orderBy(desc(count()), sql`min(${cityWaitlist.requestedName})`)
      .limit(limit);
    return rows.map((r) => ({ name: r.name, count: r.n }));
  }

  /**
   * A city just opened: mark everyone waiting for it (and anyone who asked for it by name before it
   * existed) as notified and emit `city.launched` for the worker to tell them. Their entries stay until
   * they pick the city during onboarding.
   */
  async announceLaunch(
    city: { id: string; name: string },
    tx: Tx,
    now: Date = new Date(),
  ): Promise<number> {
    const waiting = await tx
      .update(cityWaitlist)
      .set({ notifiedAt: now, cityId: city.id, requestedName: null, normalizedName: null })
      .where(
        and(
          isNull(cityWaitlist.notifiedAt),
          or(
            eq(cityWaitlist.cityId, city.id),
            and(
              isNull(cityWaitlist.cityId),
              eq(cityWaitlist.normalizedName, normalizeCityName(city.name)),
            ),
          ),
        ),
      )
      .returning({ userId: cityWaitlist.userId });
    const userIds = waiting.map((w) => w.userId);
    // The worker tells them (`city_launched`), so the admin's save never waits on push delivery.
    await this.outbox.add(tx, {
      aggregateType: 'city',
      aggregateId: city.id,
      type: CITY_LAUNCHED_EVENT,
      payload: { cityId: city.id, cityName: city.name, userIds, at: now.toISOString() },
    });
    return userIds.length;
  }

  async exportFor(userId: string): Promise<CityWaitlistStatus> {
    return this.status(userId);
  }
}
