import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { cities } from './schema/index.js';
import { pointSql } from './geography.js';

describe('PostGIS geography columns', () => {
  it('serialise points and close polygon rings as EWKT', () => {
    const centre = cities.centre.mapToDriverValue({ lat: 17.385, lng: 78.4867 });
    expect(centre).toBe('SRID=4326;POINT(78.4867 17.385)');
    const open = cities.bounds.mapToDriverValue([
      { lat: 17.2, lng: 78.2 },
      { lat: 17.6, lng: 78.2 },
      { lat: 17.6, lng: 78.7 },
    ]);
    expect(open).toBe('SRID=4326;POLYGON((78.2 17.2, 78.2 17.6, 78.7 17.6, 78.2 17.2))');
    const closed = cities.bounds.mapToDriverValue([
      { lat: 1, lng: 1 },
      { lat: 2, lng: 1 },
      { lat: 1, lng: 1 },
    ]);
    expect(closed).toBe('SRID=4326;POLYGON((1 1, 1 2, 1 1))');
    expect(cities.centre.getSQLType()).toBe('geography(Point, 4326)');
    expect(cities.bounds.getSQLType()).toBe('geography(Polygon, 4326)');
  });
  it('builds parameterised point SQL (no string interpolation of values)', () => {
    const q = new PgDialect().sqlToQuery(pointSql({ lat: 17.4, lng: 78.4 }));
    expect(q.sql).toBe('ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography');
    expect(q.params).toEqual([78.4, 17.4]);
  });
});
