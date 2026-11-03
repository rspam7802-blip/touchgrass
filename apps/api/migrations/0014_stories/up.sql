-- Phase 13: squad stories (photos for 24 hours, seen by the squad or squad + friends of friends).

-- New media purpose and report target (CHECK lists widened; existing rows are unaffected).
ALTER TABLE media_assets DROP CONSTRAINT media_assets_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purpose_check
  CHECK (purpose IN ('profile_photo', 'event_cover', 'lore', 'chat', 'verification_selfie', 'report_screenshot', 'story'));
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'event', 'message', 'lore_media', 'story'));

CREATE TABLE stories (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  author_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  media_id uuid NOT NULL UNIQUE REFERENCES media_assets (id) ON DELETE CASCADE,
  caption text NOT NULL DEFAULT '' CHECK (length(caption) <= 200),
  audience text NOT NULL CHECK (audience IN ('squad', 'squad_fof')),
  -- Caption tripped the text filter: hidden from everyone but the author until reviewed (F-SAF-06).
  held_at timestamptz,
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'removed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX stories_author_live_idx ON stories (author_id, expires_at) WHERE status = 'live';
CREATE INDEX stories_live_fof_idx ON stories (expires_at, author_id) WHERE status = 'live' AND audience = 'squad_fof';
CREATE INDEX stories_expires_idx ON stories (expires_at);
CREATE TRIGGER stories_updated_at BEFORE UPDATE ON stories FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE story_views (
  story_id uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  viewer_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, viewer_id)
);
CREATE INDEX story_views_viewer_idx ON story_views (viewer_id);
CREATE INDEX story_views_story_recent_idx ON story_views (story_id, viewed_at DESC, viewer_id DESC);

CREATE TABLE story_likes (
  story_id uuid NOT NULL REFERENCES stories (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (story_id, user_id)
);
CREATE INDEX story_likes_user_idx ON story_likes (user_id);
