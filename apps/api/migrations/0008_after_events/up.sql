-- Phase 7: feedback, host ratings, reconnect pulls, post-event prompts, Lore albums, reliability.

CREATE TABLE event_feedback (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  great text[] NOT NULL DEFAULT '{}',
  improve text[] NOT NULL DEFAULT '{}',
  comment text NOT NULL DEFAULT '' CHECK (length(comment) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_feedback_user_idx ON event_feedback (user_id);
CREATE TRIGGER event_feedback_updated_at BEFORE UPDATE ON event_feedback FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE host_ratings (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  rater_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  host_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, rater_id),
  CHECK (rater_id <> host_user_id)
);
CREATE INDEX host_ratings_host_idx ON host_ratings (host_user_id);
CREATE TRIGGER host_ratings_updated_at BEFORE UPDATE ON host_ratings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- "Pull" someone you met at a plan (F-AFT-03); mutual pulls become squad through the social graph.
CREATE TABLE reconnect_pulls (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  from_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  to_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, from_user_id, to_user_id),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX reconnect_pulls_to_idx ON reconnect_pulls (to_user_id, event_id);

CREATE TABLE post_event_prompts (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_id)
);

CREATE TABLE lore_albums (
  event_id uuid PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  visibility text NOT NULL DEFAULT 'attendees' CHECK (visibility IN ('attendees', 'friends_of_attendees')),
  cover_media_id uuid REFERENCES media_assets (id) ON DELETE SET NULL,
  -- Lore items the current cover was made from (the collage is redrawn when this changes).
  cover_source text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER lore_albums_updated_at BEFORE UPDATE ON lore_albums FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE lore_items (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  media_id uuid NOT NULL UNIQUE REFERENCES media_assets (id) ON DELETE CASCADE,
  uploader_id uuid REFERENCES users (id) ON DELETE SET NULL,
  caption text NOT NULL DEFAULT '' CHECK (length(caption) <= 200),
  status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  removed_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lore_items_event_idx ON lore_items (event_id, created_at DESC, id DESC) WHERE status = 'visible';
CREATE INDEX lore_items_uploader_idx ON lore_items (uploader_id, event_id);
CREATE TRIGGER lore_items_updated_at BEFORE UPDATE ON lore_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Reliability ledger (F-SAF-02): one row per commitment outcome.
CREATE TABLE reliability_events (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('check_in', 'no_show', 'late_cancel')),
  at timestamptz NOT NULL,
  PRIMARY KEY (user_id, event_id, kind)
);
CREATE INDEX reliability_events_recent_idx ON reliability_events (at);

CREATE TABLE reliability_scores (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  score numeric(5, 1) NOT NULL,
  tier text NOT NULL CHECK (tier IN ('new', 'super_reliable', 'reliable', 'hit_or_miss', 'flaky')),
  no_shows_recent integer NOT NULL DEFAULT 0,
  cooldown_until timestamptz,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reliability_scores_cooldown_idx ON reliability_scores (cooldown_until) WHERE cooldown_until IS NOT NULL;
