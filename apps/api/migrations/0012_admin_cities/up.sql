-- Phase 11: complete admin dashboard, multi-city and curators (F-WEB-03, F-GRW-03).

-- ---------- curators manage their city's feed: featured plans ----------
ALTER TABLE events
  ADD COLUMN featured_until timestamptz,
  ADD COLUMN featured_rank smallint,
  ADD COLUMN featured_by uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD CONSTRAINT events_featured_rank_chk CHECK (
    (featured_until IS NULL AND featured_rank IS NULL) OR
    (featured_until IS NOT NULL AND featured_rank BETWEEN 1 AND 10)
  );
CREATE INDEX events_featured_idx ON events (city_id, featured_rank, starts_at)
  WHERE featured_until IS NOT NULL;
CREATE INDEX events_admin_list_idx ON events (city_id, starts_at DESC, id DESC);

-- ---------- city waitlist ----------
CREATE TABLE city_waitlist (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  city_id uuid REFERENCES cities (id) ON DELETE CASCADE,
  requested_name text,
  normalized_name text,
  notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT city_waitlist_target_chk CHECK (
    (city_id IS NOT NULL AND requested_name IS NULL AND normalized_name IS NULL) OR
    (city_id IS NULL AND requested_name IS NOT NULL AND normalized_name IS NOT NULL)
  )
);
CREATE INDEX city_waitlist_city_idx ON city_waitlist (city_id, created_at, user_id) WHERE city_id IS NOT NULL;
CREATE INDEX city_waitlist_name_idx ON city_waitlist (normalized_name, created_at, user_id) WHERE city_id IS NULL;

-- ---------- recommendation weights (F-DSC-07 tuning) ----------
CREATE TABLE ranking_weights (
  key text PRIMARY KEY,
  value numeric(5, 2) NOT NULL CHECK (value >= 0 AND value <= 10),
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ---------- notification wording overrides ----------
CREATE TABLE notification_template_overrides (
  kind text NOT NULL,
  language text NOT NULL CHECK (language IN ('en', 'te', 'hi')),
  title text NOT NULL,
  body text NOT NULL,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, language)
);

-- ---------- analytics overview read model (counters from domain events) ----------
-- city_id is the all-zero uuid when the action has no city (e.g. a sign-up before onboarding).
CREATE TABLE analytics_daily (
  day date NOT NULL,
  city_id uuid NOT NULL,
  metric text NOT NULL,
  value bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, city_id, metric)
);
CREATE TABLE analytics_active (
  day date NOT NULL,
  user_id uuid NOT NULL,
  city_id uuid NOT NULL,
  PRIMARY KEY (day, user_id)
);
CREATE INDEX analytics_active_city_idx ON analytics_active (city_id, day);
