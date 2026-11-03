import type { GeoPoint } from '@touchgrass/shared';
import { customType } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';

/**
 * PostGIS geography(Point,4326). Reads come back as EWKB hex; we always select points via
 * `ST_AsGeoJSON` helpers instead, so the column type is write-oriented.
 */
export const geographyPoint = customType<{ data: GeoPoint; driverData: string }>({
  dataType() {
    return 'geography(Point, 4326)';
  },
  toDriver(value: GeoPoint): string {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
});

export const geographyPolygon = customType<{ data: GeoPoint[]; driverData: string }>({
  dataType() {
    return 'geography(Polygon, 4326)';
  },
  toDriver(ring: GeoPoint[]): string {
    const first = ring[0];
    const last = ring[ring.length - 1];
    const closed =
      first && last && (first.lat !== last.lat || first.lng !== last.lng) ? [...ring, first] : ring;
    return `SRID=4326;POLYGON((${closed.map((p) => `${p.lng} ${p.lat}`).join(', ')}))`;
  },
});

/** SQL expression for a geography point literal, safe from injection (values are numbers bound as params). */
export function pointSql(p: GeoPoint): SQL {
  return sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;
}
