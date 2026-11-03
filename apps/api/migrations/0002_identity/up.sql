-- Phase 1: identity, sessions, invites, profiles, taxonomy, media, consents, moderation queue, admin audit, settings.

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  phone_e164 text UNIQUE,
  -- SHA-256 of the E.164 number: what contact matching (Phase 2) compares against. Never the raw number.
  phone_hash text UNIQUE,
  status text NOT NULL DEFAULT 'onboarding'
    CHECK (status IN ('onboarding', 'active', 'age_blocked', 'suspended', 'banned', 'deletion_pending', 'deleted')),
  language text NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'te', 'hi')),
  city_id uuid REFERENCES cities (id),
  invited_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  invite_quota_override integer CHECK (invite_quota_override >= 0),
  verified_at timestamptz,
  deletion_requested_at timestamptz,
  deleted_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_city_idx ON users (city_id) WHERE status = 'active';
CREATE INDEX users_invited_by_idx ON users (invited_by_user_id);
CREATE INDEX users_deletion_due_idx ON users (deletion_requested_at) WHERE status = 'deletion_pending';
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('super_admin', 'admin', 'moderator', 'city_curator', 'support')),
  -- Curators are scoped to a city; other roles are global (NULL).
  city_id uuid REFERENCES cities (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX user_roles_unique ON user_roles (user_id, role, coalesce(city_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE TABLE otp_requests (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  phone_e164 text NOT NULL,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  request_ip inet,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_requests_phone_recent_idx ON otp_requests (phone_e164, created_at DESC);
CREATE INDEX otp_requests_expiry_idx ON otp_requests (expires_at);
CREATE TRIGGER otp_requests_updated_at BEFORE UPDATE ON otp_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_name text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  app_version text NOT NULL,
  ip inet,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_sessions_active_idx ON user_sessions (user_id, last_used_at DESC) WHERE revoked_at IS NULL;
CREATE TRIGGER user_sessions_updated_at BEFORE UPDATE ON user_sessions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Rotating refresh tokens. Each refresh rotates; presenting an already-rotated token revokes the whole session (reuse detection).
CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  session_id uuid NOT NULL REFERENCES user_sessions (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens (session_id);
CREATE TRIGGER refresh_tokens_updated_at BEFORE UPDATE ON refresh_tokens FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invite_codes (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  code citext NOT NULL UNIQUE,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('user', 'admin')),
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses >= 1),
  uses integer NOT NULL DEFAULT 0 CHECK (uses >= 0 AND uses <= max_uses),
  expires_at timestamptz,
  revoked_at timestamptz,
  label text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invite_codes_creator_idx ON invite_codes (created_by_user_id, created_at DESC);
CREATE INDEX invite_codes_admin_list_idx ON invite_codes (created_at DESC, id DESC);
CREATE TRIGGER invite_codes_updated_at BEFORE UPDATE ON invite_codes FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invite_redemptions (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  invite_code_id uuid NOT NULL REFERENCES invite_codes (id),
  user_id uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invite_redemptions_code_idx ON invite_redemptions (invite_code_id);

CREATE TABLE interests (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  slug text NOT NULL UNIQUE,
  name jsonb NOT NULL,
  emoji text NOT NULL,
  category text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER interests_updated_at BEFORE UPDATE ON interests FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE vibe_tags (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  slug text NOT NULL UNIQUE,
  name jsonb NOT NULL,
  emoji text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER vibe_tags_updated_at BEFORE UPDATE ON vibe_tags FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  display_name text,
  bio text NOT NULL DEFAULT '',
  date_of_birth date,
  gender text CHECK (gender IN ('woman', 'man', 'non_binary', 'prefer_not_to_say')),
  pronouns text,
  city_id uuid REFERENCES cities (id),
  neighbourhood_id uuid REFERENCES neighbourhoods (id),
  spoken_languages text[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL DEFAULT 'everyone' CHECK (visibility IN ('everyone', 'friends_of_friends', 'squad_only')),
  show_first_timer_badge boolean NOT NULL DEFAULT true,
  read_receipts boolean NOT NULL DEFAULT true,
  show_in_who_is_going boolean NOT NULL DEFAULT true,
  onboarding_completed_at timestamptz,
  tutorial_completed_at timestamptz,
  search_document tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(display_name, ''))) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX profiles_city_idx ON profiles (city_id, neighbourhood_id);
CREATE INDEX profiles_name_trgm ON profiles USING gin (display_name gin_trgm_ops);
CREATE INDEX profiles_search_idx ON profiles USING gin (search_document);
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE user_interests (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  interest_id uuid NOT NULL REFERENCES interests (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, interest_id)
);
CREATE INDEX user_interests_interest_idx ON user_interests (interest_id, user_id);

CREATE TABLE user_vibe_tags (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  vibe_tag_id uuid NOT NULL REFERENCES vibe_tags (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, vibe_tag_id)
);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  owner_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  purpose text NOT NULL CHECK (purpose IN ('profile_photo', 'event_cover', 'lore', 'chat', 'verification_selfie', 'report_screenshot')),
  original_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  declared_bytes integer NOT NULL,
  status text NOT NULL DEFAULT 'pending_upload'
    CHECK (status IN ('pending_upload', 'processing', 'ready', 'flagged', 'rejected', 'deleted')),
  width integer,
  height integer,
  variant_keys jsonb,
  moderation_labels jsonb,
  processed_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_owner_idx ON media_assets (owner_user_id, created_at DESC);
CREATE INDEX media_assets_stale_uploads_idx ON media_assets (created_at) WHERE status = 'pending_upload';
CREATE TRIGGER media_assets_updated_at BEFORE UPDATE ON media_assets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE profile_photos (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL UNIQUE REFERENCES media_assets (id),
  position integer NOT NULL CHECK (position BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, position) DEFERRABLE INITIALLY DEFERRED
);

-- Append-only consent ledger (DPDP Act 2023). Kept after account deletion.
CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id),
  kind text NOT NULL CHECK (kind IN ('terms', 'privacy', 'age_confirmation', 'notifications', 'contacts', 'location', 'marketing')),
  granted boolean NOT NULL,
  version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX consents_user_idx ON consents (user_id, kind, created_at DESC);

CREATE TABLE notification_preferences (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  category text NOT NULL,
  push boolean NOT NULL,
  in_app boolean NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);
CREATE TRIGGER notification_preferences_updated_at BEFORE UPDATE ON notification_preferences FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  session_id uuid REFERENCES user_sessions (id) ON DELETE SET NULL,
  expo_push_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX devices_user_active_idx ON devices (user_id) WHERE disabled_at IS NULL;
CREATE TRIGGER devices_updated_at BEFORE UPDATE ON devices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE moderation_items (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  source text NOT NULL CHECK (source IN ('auto_image', 'auto_text', 'report')),
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  details jsonb NOT NULL DEFAULT '{}',
  city_id uuid REFERENCES cities (id),
  resolved_by_user_id uuid REFERENCES users (id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_items_open_idx ON moderation_items (severity, created_at) WHERE status = 'open';
CREATE UNIQUE INDEX moderation_items_open_target_unique ON moderation_items (target_type, target_id, source) WHERE status = 'open';
CREATE TRIGGER moderation_items_updated_at BEFORE UPDATE ON moderation_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Every admin action, append-only.
CREATE TABLE admin_actions (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  admin_user_id uuid NOT NULL REFERENCES users (id),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_actions_recent_idx ON admin_actions (created_at DESC, id DESC);
CREATE INDEX admin_actions_target_idx ON admin_actions (target_type, target_id);

CREATE TABLE app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER app_settings_updated_at BEFORE UPDATE ON app_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
