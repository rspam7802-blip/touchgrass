import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadMigrations, migrateDown, migrateUp } from '../src/infra/database/migrator.js';

describe('migrations', () => {
  let admin: pg.Pool;
  let pool: pg.Pool;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: inject('databaseUrl'), max: 1 });
    await admin.query('DROP DATABASE IF EXISTS migration_check');
    await admin.query('CREATE DATABASE migration_check');
    const url = new URL(inject('databaseUrl'));
    url.pathname = '/migration_check';
    pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  });

  afterAll(async () => {
    await pool.end();
    await admin.query('DROP DATABASE IF EXISTS migration_check');
    await admin.end();
  });

  const tables = async (): Promise<string[]> =>
    (
      await pool.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY 1",
      )
    ).rows.map((r) => r.table_name);

  it('applies every migration, is idempotent, and fully reverses', async () => {
    const all = loadMigrations();
    expect(await migrateUp(pool)).toHaveLength(all.length);
    expect(await migrateUp(pool)).toEqual([]);
    expect(await tables()).toEqual(
      expect.arrayContaining([
        'cities',
        'feature_flags',
        'neighbourhoods',
        'outbox_events',
        'schema_migrations',
      ]),
    );

    expect(await migrateDown(pool, all.length)).toHaveLength(all.length);
    const remaining = (await tables()).filter((t) => t !== 'spatial_ref_sys');
    expect(remaining).toEqual(['schema_migrations']);

    expect(await migrateUp(pool)).toHaveLength(all.length);
  });

  it('generates time-ordered UUID v7 ids in SQL', async () => {
    const { rows } = await pool.query<{ a: string; b: string }>(
      'SELECT uuid_v7() AS a, uuid_v7() AS b',
    );
    const row = rows[0];
    expect(row?.a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((row?.a ?? '') < (row?.b ?? '') || row?.a.slice(0, 13) === row?.b.slice(0, 13)).toBe(
      true,
    );
  });

  it('creates monthly partitions idempotently', async () => {
    await pool.query(
      'CREATE TABLE part_probe (id uuid, created_at timestamptz NOT NULL) PARTITION BY RANGE (created_at)',
    );
    const first = await pool.query<{ p: string }>(
      "SELECT ensure_monthly_partition('part_probe', '2026-11-15') AS p",
    );
    const again = await pool.query<{ p: string }>(
      "SELECT ensure_monthly_partition('part_probe', '2026-11-01') AS p",
    );
    expect(first.rows[0]?.p).toBe('part_probe_202611');
    expect(again.rows[0]?.p).toBe('part_probe_202611');
    await pool.query("INSERT INTO part_probe VALUES (uuid_v7(), '2026-11-20')");
    await expect(
      pool.query("INSERT INTO part_probe VALUES (uuid_v7(), '2026-12-01')"),
    ).rejects.toThrow(/no partition/);
    await pool.query('DROP TABLE part_probe');
  });

  it('refuses to run when an applied migration was edited', async () => {
    const edited = loadMigrations().map((m, i) => (i === 0 ? { ...m, checksum: 'tampered' } : m));
    await expect(migrateUp(pool, edited)).rejects.toThrow(/Checksum mismatch/);
  });
});
