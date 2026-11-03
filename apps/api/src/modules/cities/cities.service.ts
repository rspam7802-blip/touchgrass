import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminCity,
  City,
  Neighbourhood,
  UpsertCityBody,
  UpsertNeighbourhoodBody,
} from '@touchgrass/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { Snapshot } from '../../common/cache/snapshot.js';
import { AppError } from '../../common/errors/app-error.js';
import type { DbOrTx } from '../../infra/database/types.js';
import { DB, type Database } from '../../infra/database/database.module.js';
import { cities, neighbourhoods } from '../../infra/database/schema/index.js';

/** Cities are data, not code (F-GRW-03). */
@Injectable()
export class CitiesService {
  /** Zones and area names are read for every plan shown; both tables are small and admin-edited. */
  private readonly names = new Snapshot(
    async () => ({
      zones: new Map(
        (await this.db.select({ id: cities.id, timezone: cities.timezone }).from(cities)).map(
          (r) => [r.id, r.timezone],
        ),
      ),
      hoods: new Map(
        (
          await this.db
            .select({ id: neighbourhoods.id, name: neighbourhoods.name })
            .from(neighbourhoods)
        ).map((r) => [r.id, r.name]),
      ),
    }),
    60_000,
  );

  constructor(@Inject(DB) private readonly db: Database) {}

  async list(): Promise<City[]> {
    const rows = await this.db
      .select({
        id: cities.id,
        slug: cities.slug,
        name: cities.name,
        lat: sql<number>`ST_Y(${cities.centre}::geometry)`,
        lng: sql<number>`ST_X(${cities.centre}::geometry)`,
        timezone: cities.timezone,
        launchStatus: cities.launchStatus,
        languages: cities.languages,
      })
      .from(cities)
      .orderBy(asc(cities.name));
    return rows.map(({ lat, lng, ...c }) => ({ ...c, centre: { lat, lng } }));
  }

  async neighbourhoods(cityId: string): Promise<Neighbourhood[]> {
    const rows = await this.db
      .select({
        id: neighbourhoods.id,
        cityId: neighbourhoods.cityId,
        slug: neighbourhoods.slug,
        name: neighbourhoods.name,
        lat: sql<number>`ST_Y(${neighbourhoods.centroid}::geometry)`,
        lng: sql<number>`ST_X(${neighbourhoods.centroid}::geometry)`,
      })
      .from(neighbourhoods)
      .where(eq(neighbourhoods.cityId, cityId))
      .orderBy(asc(neighbourhoods.name));
    return rows.map(({ lat, lng, ...n }) => ({ ...n, centroid: { lat, lng } }));
  }

  async exists(cityId: string): Promise<boolean> {
    return (
      (await this.db.select({ id: cities.id }).from(cities).where(eq(cities.id, cityId)).limit(1))
        .length === 1
    );
  }

  async neighbourhoodInCity(neighbourhoodId: string, cityId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ cityId: neighbourhoods.cityId })
      .from(neighbourhoods)
      .where(eq(neighbourhoods.id, neighbourhoodId))
      .limit(1);
    return row?.cityId === cityId;
  }

  async neighbourhoodName(neighbourhoodId: string | null): Promise<string | null> {
    if (!neighbourhoodId) return null;
    const [row] = await this.db
      .select({ name: neighbourhoods.name })
      .from(neighbourhoods)
      .where(eq(neighbourhoods.id, neighbourhoodId))
      .limit(1);
    return row?.name ?? null;
  }

  /** The open (beta or launched) city, and neighbourhood if any, containing a point. Waitlist cities don't count. */
  async locate(point: { lat: number; lng: number }): Promise<{
    cityId: string;
    neighbourhoodId: string | null;
    neighbourhoodName: string | null;
    centroid: { lat: number; lng: number } | null;
  } | null> {
    const res = await this.db.execute<{
      city_id: string;
      hood_id: string | null;
      hood_name: string | null;
      lat: number | null;
      lng: number | null;
    }>(sql`
      SELECT c.id AS city_id, n.id AS hood_id, n.name AS hood_name, ST_Y(n.centroid::geometry) AS lat, ST_X(n.centroid::geometry) AS lng
      FROM cities c
      LEFT JOIN neighbourhoods n ON n.city_id = c.id AND ST_Covers(n.boundary, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography)
      WHERE ST_Covers(c.bounds, ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography)
        AND c.launch_status <> 'waitlist'
      ORDER BY n.id NULLS LAST LIMIT 1`);
    const row = res.rows[0];
    if (!row) return null;
    return {
      cityId: row.city_id,
      neighbourhoodId: row.hood_id,
      neighbourhoodName: row.hood_name,
      centroid: row.lat !== null && row.lng !== null ? { lat: row.lat, lng: row.lng } : null,
    };
  }

  async centre(cityId: string): Promise<{ lat: number; lng: number } | null> {
    const res = await this.db.execute<{ lat: number; lng: number }>(sql`
      SELECT ST_Y(centre::geometry) AS lat, ST_X(centre::geometry) AS lng FROM cities WHERE id = ${cityId}`);
    return res.rows[0] ?? null;
  }

  async launchedCityCentres(): Promise<{ id: string; centre: { lat: number; lng: number } }[]> {
    const res = await this.db.execute<{ id: string; lat: number; lng: number }>(sql`
      SELECT id, ST_Y(centre::geometry) AS lat, ST_X(centre::geometry) AS lng FROM cities WHERE launch_status <> 'waitlist'`);
    return res.rows.map((r) => ({ id: r.id, centre: { lat: r.lat, lng: r.lng } }));
  }

  async centroid(neighbourhoodId: string): Promise<{ lat: number; lng: number } | null> {
    const res = await this.db.execute<{ lat: number; lng: number }>(sql`
      SELECT ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng FROM neighbourhoods WHERE id = ${neighbourhoodId}`);
    return res.rows[0] ?? null;
  }

  async neighbourhoodNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { hoods } = await this.names.get();
    return new Map(
      ids.flatMap((id) => (hoods.has(id) ? [[id, hoods.get(id) ?? ''] as const] : [])),
    );
  }
  // ---------- per-city facts used across modules ----------

  async timezones(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { zones } = await this.names.get();
    return new Map(
      ids.flatMap((id) => (zones.has(id) ? [[id, zones.get(id) ?? ''] as const] : [])),
    );
  }

  async byId(
    id: string,
    db: DbOrTx = this.db,
  ): Promise<{
    id: string;
    name: string;
    timezone: string;
    launchStatus: City['launchStatus'];
  } | null> {
    const [row] = await db
      .select({
        id: cities.id,
        name: cities.name,
        timezone: cities.timezone,
        launchStatus: cities.launchStatus,
      })
      .from(cities)
      .where(eq(cities.id, id))
      .limit(1);
    return row ?? null;
  }

  /** People can live in (and plan in) beta and launched cities; waitlist cities are not open yet. */
  async isOpen(cityId: string): Promise<boolean> {
    const city = await this.byId(cityId);
    return city !== null && city.launchStatus !== 'waitlist';
  }

  // ---------- admin (F-GRW-03) ----------

  /** Every city with its bounds and neighbourhoods; `only` limits the list for city curators. */
  async adminList(
    only: 'all' | readonly string[],
  ): Promise<Omit<AdminCity, 'waitlist' | 'curators'>[]> {
    if (only !== 'all' && only.length === 0) return [];
    const res = await this.db.execute<{
      id: string;
      slug: string;
      name: string;
      lat: number;
      lng: number;
      south: number;
      west: number;
      north: number;
      east: number;
      timezone: string;
      launch_status: City['launchStatus'];
      languages: string[];
    }>(sql`
      SELECT id, slug, name, timezone, launch_status, languages,
        ST_Y(centre::geometry) AS lat, ST_X(centre::geometry) AS lng,
        ST_YMin(bounds::geometry) AS south, ST_XMin(bounds::geometry) AS west,
        ST_YMax(bounds::geometry) AS north, ST_XMax(bounds::geometry) AS east
      FROM cities
      ${
        only === 'all'
          ? sql``
          : sql`WHERE id IN (${sql.join(
              only.map((id) => sql`${id}`),
              sql`, `,
            )})`
      }
      ORDER BY name`);
    const ids = res.rows.map((r) => r.id);
    const hoods =
      ids.length === 0
        ? []
        : await this.db
            .select({
              id: neighbourhoods.id,
              cityId: neighbourhoods.cityId,
              slug: neighbourhoods.slug,
              name: neighbourhoods.name,
              lat: sql<number>`ST_Y(${neighbourhoods.centroid}::geometry)`,
              lng: sql<number>`ST_X(${neighbourhoods.centroid}::geometry)`,
            })
            .from(neighbourhoods)
            .where(inArray(neighbourhoods.cityId, ids))
            .orderBy(asc(neighbourhoods.name));
    return res.rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      centre: { lat: r.lat, lng: r.lng },
      bounds: {
        south: r.south,
        west: r.west,
        north: r.north,
        east: r.east,
      },
      timezone: r.timezone,
      launchStatus: r.launch_status,
      languages: r.languages,
      neighbourhoods: hoods
        .filter((h) => h.cityId === r.id)
        .map((h) => ({
          id: h.id,
          slug: h.slug,
          name: h.name,
          centroid: { lat: h.lat, lng: h.lng },
        })),
    }));
  }

  /** Creates or updates a city; returns its id and the launch status it had before (null when new). */
  async upsert(
    id: string | null,
    body: UpsertCityBody,
    db: DbOrTx,
  ): Promise<{ id: string; previousStatus: City['launchStatus'] | null }> {
    const clash = await db
      .select({ id: cities.id })
      .from(cities)
      .where(eq(cities.slug, body.slug))
      .limit(1);
    if (clash[0] && clash[0].id !== id)
      throw new AppError('CONFLICT', 'Another city uses that slug', { reason: 'SLUG_TAKEN' });
    const centre = sql`ST_SetSRID(ST_MakePoint(${body.centre.lng}, ${body.centre.lat}), 4326)::geography`;
    const bounds = sql`ST_MakeEnvelope(${body.bounds.west}, ${body.bounds.south}, ${body.bounds.east}, ${body.bounds.north}, 4326)::geography`;
    const values = {
      slug: body.slug,
      name: body.name,
      timezone: body.timezone,
      launchStatus: body.launchStatus,
      languages: body.languages,
    };
    if (id === null) {
      const newId = uuidv7();
      await db.execute(sql`
        INSERT INTO cities (id, slug, name, centre, bounds, timezone, launch_status, languages)
        VALUES (${newId}, ${values.slug}, ${values.name}, ${centre}, ${bounds}, ${values.timezone},
          ${values.launchStatus}, ${sql`ARRAY[${sql.join(
            values.languages.map((l) => sql`${l}`),
            sql`, `,
          )}]::text[]`})`);
      this.names.invalidate();
      return { id: newId, previousStatus: null };
    }
    const [before] = await db
      .select({ status: cities.launchStatus })
      .from(cities)
      .where(eq(cities.id, id))
      .for('update');
    if (!before) throw AppError.notFound('City');
    await db.execute(sql`
      UPDATE cities SET slug = ${values.slug}, name = ${values.name}, centre = ${centre}, bounds = ${bounds},
        timezone = ${values.timezone}, launch_status = ${values.launchStatus},
        languages = ${sql`ARRAY[${sql.join(
          values.languages.map((l) => sql`${l}`),
          sql`, `,
        )}]::text[]`},
        updated_at = now()
      WHERE id = ${id}`);
    this.names.invalidate();
    return { id, previousStatus: before.status };
  }

  async upsertNeighbourhood(
    cityId: string,
    id: string | null,
    body: UpsertNeighbourhoodBody,
    db: DbOrTx,
  ): Promise<string> {
    if (!(await this.byId(cityId, db))) throw AppError.notFound('City');
    if (id !== null) {
      const [row] = await db
        .select({ id: neighbourhoods.id })
        .from(neighbourhoods)
        .where(and(eq(neighbourhoods.id, id), eq(neighbourhoods.cityId, cityId)));
      if (!row) throw AppError.notFound('Neighbourhood');
    }
    const clash = await db
      .select({ id: neighbourhoods.id })
      .from(neighbourhoods)
      .where(and(eq(neighbourhoods.cityId, cityId), eq(neighbourhoods.slug, body.slug)))
      .limit(1);
    if (clash[0] && clash[0].id !== id)
      throw new AppError('CONFLICT', 'Another neighbourhood uses that slug', {
        reason: 'SLUG_TAKEN',
      });
    const point = sql`ST_SetSRID(ST_MakePoint(${body.centroid.lng}, ${body.centroid.lat}), 4326)::geography`;
    const inside = await db.execute<{ ok: boolean }>(
      sql`SELECT ST_Covers(bounds, ${point}) AS ok FROM cities WHERE id = ${cityId}`,
    );
    if (!inside.rows[0]?.ok)
      throw new AppError('VALIDATION_FAILED', 'The neighbourhood must be inside the city', [
        { path: 'centroid', message: 'Outside the city bounds', code: 'custom' },
      ]);
    const boundary = sql`ST_Buffer(${point}, ${body.radiusKm * 1000})`;
    if (id === null) {
      const newId = uuidv7();
      await db.execute(sql`
        INSERT INTO neighbourhoods (id, city_id, slug, name, centroid, boundary)
        VALUES (${newId}, ${cityId}, ${body.slug}, ${body.name}, ${point}, ${boundary})`);
      this.names.invalidate();
      return newId;
    }
    await db.execute(sql`
      UPDATE neighbourhoods SET slug = ${body.slug}, name = ${body.name}, centroid = ${point},
        boundary = ${boundary}, updated_at = now()
      WHERE id = ${id}`);
    this.names.invalidate();
    return id;
  }
}
