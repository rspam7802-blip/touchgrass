-- Phase 2: social graph (contacts, squad, blocks), reports, suggestions, activity feed.

ALTER TABLE profiles
  ADD COLUMN share_activity boolean NOT NULL DEFAULT true,
  ADD COLUMN discoverable_by_contacts boolean NOT NULL DEFAULT true;

-- Hashed (SHA-256 of E.164) numbers from a user's address book. Raw numbers never reach the server (F-SOC-01).
CREATE TABLE contact_hashes (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  phone_hash text NOT NULL CHECK (phone_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, phone_hash)
);
-- Reverse lookup: "who has me in their contacts" (contact-based suggestions).
CREATE INDEX contact_hashes_hash_idx ON contact_hashes (phone_hash);

-- One row per unordered pair (user_low < user_high), whoever asked first is the requester.
CREATE TABLE friendships (
  user_low uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  user_high uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high),
  CHECK (requester_id = user_low OR requester_id = user_high)
);
CREATE INDEX friendships_low_status_idx ON friendships (user_low, status, updated_at DESC);
CREATE INDEX friendships_high_status_idx ON friendships (user_high, status, updated_at DESC);
CREATE TRIGGER friendships_updated_at BEFORE UPDATE ON friendships FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Accepted friendships expanded to both directions: the hot path for squad, mutuals and friends-of-friends.
CREATE VIEW squad_edges AS
  SELECT user_low AS user_id, user_high AS friend_id, updated_at AS since FROM friendships WHERE status = 'accepted'
  UNION ALL
  SELECT user_high AS user_id, user_low AS friend_id, updated_at AS since FROM friendships WHERE status = 'accepted';

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id);

CREATE TABLE suggestion_dismissals (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  dismissed_user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, dismissed_user_id)
);

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  -- Nulled when the reporter's account is purged; the report itself is kept for safety records.
  reporter_id uuid REFERENCES users (id) ON DELETE SET NULL,
  target_type text NOT NULL CHECK (target_type IN ('user', 'event', 'message', 'lore_media')),
  target_id uuid NOT NULL,
  category text NOT NULL,
  details text NOT NULL DEFAULT '',
  screenshot_media_ids uuid[] NOT NULL DEFAULT '{}',
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  city_id uuid REFERENCES cities (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_target_idx ON reports (target_type, target_id, created_at DESC);
CREATE INDEX reports_reporter_idx ON reports (reporter_id, created_at DESC);
-- A person can report the same thing once per day; repeated taps are idempotent.
CREATE UNIQUE INDEX reports_dedupe_idx ON reports (reporter_id, target_type, target_id, ((created_at AT TIME ZONE 'Asia/Kolkata')::date));

CREATE TABLE activity_events (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  actor_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  verb text NOT NULL CHECK (verb IN ('joined', 'squad_joined', 'pulled_up', 'plotted', 'badge_earned', 'lore_posted')),
  subject_user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  object_type text,
  object_id uuid,
  -- Outbox event that produced this row: makes the at-least-once worker handler idempotent.
  source_event_id uuid NOT NULL,
  city_id uuid REFERENCES cities (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_event_id, actor_id)
);
CREATE INDEX activity_events_actor_recent_idx ON activity_events (actor_id, created_at DESC, id DESC);
CREATE INDEX activity_events_object_idx ON activity_events (object_type, object_id);
