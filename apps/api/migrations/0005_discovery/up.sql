-- Phase 4: discovery. Impression/click logs (monthly partitions) and a partial GIST for the feed.

-- Monthly range partitions for append-only logs (also used by chat messages and notifications later).
-- Creates partitions from the current month through `months_ahead` months ahead; idempotent.
CREATE OR REPLACE FUNCTION ensure_monthly_partitions(parent text, months_ahead integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  first_month date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  m date;
  created integer := 0;
  part text;
BEGIN
  FOR i IN 0..months_ahead LOOP
    m := (first_month + make_interval(months => i))::date;
    part := format('%s_y%sm%s', parent, to_char(m, 'YYYY'), to_char(m, 'MM'));
    IF to_regclass(part) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        part, parent, m::timestamptz, (m + interval '1 month')::timestamptz
      );
      created := created + 1;
    END IF;
  END LOOP;
  RETURN created;
END;
$$;

-- Drops whole monthly partitions older than `keep_months` (retention without row-by-row deletes).
CREATE OR REPLACE FUNCTION drop_monthly_partitions_before(parent text, keep_months integer)
RETURNS integer LANGUAGE plpgsql AS $$
DECLARE
  cutoff date := (date_trunc('month', now() AT TIME ZONE 'UTC') - make_interval(months => keep_months))::date;
  r record;
  dropped integer := 0;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    JOIN pg_class p ON p.oid = i.inhparent
    WHERE p.relname = parent AND c.relname ~ '_y[0-9]{4}m[0-9]{2}$'
  LOOP
    IF to_date(substring(r.relname from '_y([0-9]{4})m') || substring(r.relname from 'm([0-9]{2})$') || '01', 'YYYYMMDD') < cutoff THEN
      EXECUTE format('DROP TABLE %I', r.relname);
      dropped := dropped + 1;
    END IF;
  END LOOP;
  RETURN dropped;
END;
$$;

CREATE TABLE discovery_impressions (
  id uuid NOT NULL DEFAULT uuid_v7(),
  request_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_id uuid NOT NULL,
  position integer NOT NULL,
  score real NOT NULL,
  reasons text[] NOT NULL DEFAULT '{}',
  served_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (served_at, id)
) PARTITION BY RANGE (served_at);
CREATE INDEX discovery_impressions_user_idx ON discovery_impressions (user_id, served_at DESC);
CREATE INDEX discovery_impressions_event_idx ON discovery_impressions (event_id, served_at DESC);
CREATE INDEX discovery_impressions_request_idx ON discovery_impressions (request_id);

CREATE TABLE discovery_clicks (
  id uuid NOT NULL DEFAULT uuid_v7(),
  request_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_id uuid NOT NULL,
  position integer NOT NULL,
  clicked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clicked_at, id)
) PARTITION BY RANGE (clicked_at);
CREATE INDEX discovery_clicks_user_idx ON discovery_clicks (user_id, clicked_at DESC);
CREATE INDEX discovery_clicks_event_idx ON discovery_clicks (event_id, clicked_at DESC);

SELECT ensure_monthly_partitions('discovery_impressions', 2);
SELECT ensure_monthly_partitions('discovery_clicks', 2);

-- Feed candidates: published plans near a point (the public centre, never the exact spot).
CREATE INDEX events_published_approx_gist ON events USING gist (approx_center) WHERE status = 'published';
CREATE INDEX events_published_starts_idx ON events (starts_at) WHERE status = 'published';
