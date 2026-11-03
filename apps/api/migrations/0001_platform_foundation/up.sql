-- Platform foundation: extensions, helper functions, feature flags, transactional outbox, cities and neighbourhoods.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- UUID v7 (time-ordered) generator. Postgres 16 has no native uuidv7(); the app also generates v7 ids client-side.
CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid AS $$
DECLARE
  unix_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000);
  bytes bytea := gen_random_bytes(16);
BEGIN
  bytes := set_byte(bytes, 0, ((unix_ms >> 40) & 255)::int);
  bytes := set_byte(bytes, 1, ((unix_ms >> 32) & 255)::int);
  bytes := set_byte(bytes, 2, ((unix_ms >> 24) & 255)::int);
  bytes := set_byte(bytes, 3, ((unix_ms >> 16) & 255)::int);
  bytes := set_byte(bytes, 4, ((unix_ms >> 8) & 255)::int);
  bytes := set_byte(bytes, 5, (unix_ms & 255)::int);
  bytes := set_byte(bytes, 6, ((get_byte(bytes, 6) & 15) | 112));
  bytes := set_byte(bytes, 8, ((get_byte(bytes, 8) & 63) | 128));
  RETURN encode(bytes, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

-- Creates (idempotently) the monthly partition of a range-partitioned table for the month containing `for_date`.
-- Used for messages and notifications; a worker job calls it ahead of each month.
CREATE OR REPLACE FUNCTION ensure_monthly_partition(parent regclass, for_date date) RETURNS text AS $$
DECLARE
  start_date date := date_trunc('month', for_date)::date;
  end_date date := (date_trunc('month', for_date) + interval '1 month')::date;
  part_name text := format('%s_%s', parent::text, to_char(start_date, 'YYYYMM'));
BEGIN
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %s FOR VALUES FROM (%L) TO (%L)', part_name, parent::text, start_date, end_date);
  RETURN part_name;
END
$$ LANGUAGE plpgsql;

CREATE TABLE feature_flags (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  key text NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-z0-9_]{1,63}$'),
  enabled boolean NOT NULL,
  description text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER feature_flags_updated_at BEFORE UPDATE ON feature_flags FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Relay scans only unpublished rows, oldest first.
CREATE INDEX outbox_events_unpublished_idx ON outbox_events (created_at) WHERE published_at IS NULL;
CREATE TRIGGER outbox_events_updated_at BEFORE UPDATE ON outbox_events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE cities (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  centre geography(Point, 4326) NOT NULL,
  bounds geography(Polygon, 4326) NOT NULL,
  timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  launch_status text NOT NULL DEFAULT 'waitlist' CHECK (launch_status IN ('waitlist', 'beta', 'launched')),
  languages text[] NOT NULL DEFAULT ARRAY['en'],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cities_bounds_gist ON cities USING gist (bounds);
CREATE TRIGGER cities_updated_at BEFORE UPDATE ON cities FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE neighbourhoods (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  city_id uuid NOT NULL REFERENCES cities (id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  centroid geography(Point, 4326) NOT NULL,
  boundary geography(Polygon, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (city_id, slug)
);
CREATE INDEX neighbourhoods_boundary_gist ON neighbourhoods USING gist (boundary);
CREATE INDEX neighbourhoods_centroid_gist ON neighbourhoods USING gist (centroid);
CREATE TRIGGER neighbourhoods_updated_at BEFORE UPDATE ON neighbourhoods FOR EACH ROW EXECUTE FUNCTION set_updated_at();
