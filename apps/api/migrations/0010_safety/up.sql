-- Phase 9: verified profiles, trusted contacts + live location + SOS, sanctions, and holds on flagged text.

-- ---------- F-SAF-01 verification ----------
CREATE TABLE verifications (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  pose text NOT NULL,
  status text NOT NULL DEFAULT 'challenged'
    CHECK (status IN ('challenged', 'pending', 'approved', 'rejected', 'expired')),
  expires_at timestamptz NOT NULL,
  media_asset_id uuid REFERENCES media_assets (id) ON DELETE SET NULL,
  face_similarity real CHECK (face_similarity BETWEEN 0 AND 100),
  submitted_at timestamptz,
  reviewed_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reject_reason text CHECK (reject_reason IN ('POSE_MISMATCH', 'FACE_MISMATCH', 'UNCLEAR', 'NOT_A_PERSON', 'OTHER')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_user_idx ON verifications (user_id, created_at DESC);
CREATE INDEX verifications_pending_idx ON verifications (submitted_at, id) WHERE status = 'pending';
CREATE UNIQUE INDEX verifications_one_open_unique ON verifications (user_id) WHERE status IN ('challenged', 'pending');
CREATE TRIGGER verifications_updated_at BEFORE UPDATE ON verifications FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- F-SAF-04 trusted contacts and live location ----------
CREATE TABLE trusted_contacts (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  phone_e164 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, phone_e164)
);
CREATE TRIGGER trusted_contacts_updated_at BEFORE UPDATE ON trusted_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE live_location_shares (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  event_id uuid REFERENCES events (id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  ended_at timestamptz,
  sos_at timestamptz,
  contacts_notified integer NOT NULL DEFAULT 0,
  last_point_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > started_at)
);
-- At most one running share per person.
CREATE UNIQUE INDEX live_location_shares_one_active_unique ON live_location_shares (user_id) WHERE ended_at IS NULL;
CREATE INDEX live_location_shares_expiry_idx ON live_location_shares (expires_at) WHERE ended_at IS NULL;
CREATE INDEX live_location_shares_ended_idx ON live_location_shares (ended_at) WHERE ended_at IS NOT NULL;
CREATE TRIGGER live_location_shares_updated_at BEFORE UPDATE ON live_location_shares FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Raw fixes, never queried spatially; kept 24 hours at most.
CREATE TABLE live_location_points (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  share_id uuid NOT NULL REFERENCES live_location_shares (id) ON DELETE CASCADE,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy real,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX live_location_points_share_idx ON live_location_points (share_id, recorded_at DESC);
CREATE INDEX live_location_points_recorded_idx ON live_location_points (recorded_at);

-- ---------- F-SAF-05 sanctions ----------
CREATE TABLE user_sanctions (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('warn', 'mute', 'suspend', 'ban')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  until timestamptz,
  lifted_at timestamptz,
  lifted_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  moderation_item_id uuid REFERENCES moderation_items (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind IN ('mute', 'suspend')) = (until IS NOT NULL))
);
CREATE INDEX user_sanctions_user_idx ON user_sanctions (user_id, created_at DESC);
CREATE INDEX user_sanctions_expiring_idx ON user_sanctions (until) WHERE lifted_at IS NULL AND until IS NOT NULL;
CREATE TRIGGER user_sanctions_updated_at BEFORE UPDATE ON user_sanctions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------- F-SAF-06 holds on flagged text ----------
-- Held content is visible to its author only until a moderator releases or removes it.
ALTER TABLE messages ADD COLUMN held_at timestamptz;
ALTER TABLE profiles ADD COLUMN bio_held_at timestamptz;
ALTER TABLE events ADD COLUMN held_at timestamptz;
ALTER TABLE lore_items ADD COLUMN caption_held_at timestamptz;
ALTER TABLE crews ADD COLUMN held_at timestamptz;
ALTER TABLE plan_proposals ADD COLUMN held_at timestamptz;
