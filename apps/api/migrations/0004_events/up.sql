-- Phase 3: venues, events, hosts, invites, RSVPs, waitlist offers, +1 claims.

CREATE TABLE venues (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  city_id uuid NOT NULL REFERENCES cities (id),
  neighbourhood_id uuid REFERENCES neighbourhoods (id),
  name text NOT NULL,
  address text NOT NULL,
  location geography(Point, 4326) NOT NULL,
  google_place_id text UNIQUE,
  indoor boolean NOT NULL DEFAULT false,
  accessibility jsonb NOT NULL DEFAULT '{"stepFree": false, "accessibleRestroom": false, "quietSpace": false}',
  is_partner boolean NOT NULL DEFAULT false,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  search_document tsvector GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || address)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX venues_location_gist ON venues USING gist (location);
CREATE INDEX venues_city_idx ON venues (city_id);
CREATE INDEX venues_name_trgm ON venues USING gin (name gin_trgm_ops);
CREATE INDEX venues_search_idx ON venues USING gin (search_document);
CREATE TRIGGER venues_updated_at BEFORE UPDATE ON venues FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE saved_venues (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  venue_id uuid NOT NULL REFERENCES venues (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, venue_id)
);

CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[A-Za-z0-9]{6,16}$'),
  type text NOT NULL CHECK (type IN ('curated', 'plan', 'crew_session')),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  cover_media_id uuid REFERENCES media_assets (id),
  category_interest_id uuid REFERENCES interests (id),
  city_id uuid NOT NULL REFERENCES cities (id),
  neighbourhood_id uuid REFERENCES neighbourhoods (id),
  venue_id uuid REFERENCES venues (id),
  -- Exact spot. For mystery events this column is only read on the reveal path (never cached, never in lists).
  location geography(Point, 4326) NOT NULL,
  address text NOT NULL,
  place_name text,
  -- Public approximation for mystery events: deterministic, ≥1 km from the true spot.
  approx_center geography(Point, 4326) NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  capacity integer NOT NULL CHECK (capacity BETWEEN 2 AND 1000),
  min_group_size integer NOT NULL DEFAULT 2,
  price_paise integer NOT NULL DEFAULT 0 CHECK (price_paise >= 0),
  visibility text NOT NULL CHECK (visibility IN ('public', 'friends_of_friends', 'invite_only', 'women_only', 'balanced')),
  balanced_max_share_pct integer CHECK (balanced_max_share_pct BETWEEN 34 AND 80),
  solo_friendly boolean NOT NULL DEFAULT false,
  small_group boolean NOT NULL DEFAULT false,
  mystery boolean NOT NULL DEFAULT false,
  mystery_reveal_minutes_before integer NOT NULL DEFAULT 120,
  allow_plus_ones boolean NOT NULL DEFAULT false,
  indoor boolean NOT NULL DEFAULT false,
  accessibility jsonb NOT NULL DEFAULT '{"stepFree": false, "accessibleRestroom": false, "quietSpace": false}',
  creator_user_id uuid NOT NULL REFERENCES users (id),
  cancelled_reason text,
  cancelled_at timestamptz,
  completed_at timestamptz,
  published_at timestamptz,
  search_document tsvector GENERATED ALWAYS AS (to_tsvector('simple', title || ' ' || description)) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (visibility <> 'balanced' OR balanced_max_share_pct IS NOT NULL)
);
CREATE INDEX events_location_gist ON events USING gist (location);
CREATE INDEX events_approx_gist ON events USING gist (approx_center);
CREATE INDEX events_city_upcoming_idx ON events (city_id, starts_at, id) WHERE status = 'published';
CREATE INDEX events_creator_idx ON events (creator_user_id, starts_at DESC);
CREATE INDEX events_to_complete_idx ON events (ends_at) WHERE status = 'published';
CREATE INDEX events_search_idx ON events USING gin (search_document);
CREATE INDEX events_title_trgm ON events USING gin (title gin_trgm_ops);
CREATE TRIGGER events_updated_at BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE event_interests (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  interest_id uuid NOT NULL REFERENCES interests (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, interest_id)
);
CREATE INDEX event_interests_interest_idx ON event_interests (interest_id, event_id);

CREATE TABLE event_vibe_tags (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  vibe_tag_id uuid NOT NULL REFERENCES vibe_tags (id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, vibe_tag_id)
);
CREATE INDEX event_vibe_tags_tag_idx ON event_vibe_tags (vibe_tag_id, event_id);

CREATE TABLE event_hosts (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('host', 'co_host', 'welcome_host')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX event_hosts_user_idx ON event_hosts (user_id, event_id);

CREATE TABLE event_invites (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  invitee_user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- Share-link invites (contacts not yet on TouchGrass, or anyone with the link) carry a hashed token.
  link_token_hash text UNIQUE,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (invitee_user_id IS NOT NULL OR link_token_hash IS NOT NULL)
);
-- Several people may invite the same person; "invited by" shows the earliest.
CREATE INDEX event_invites_invitee_idx ON event_invites (event_id, invitee_user_id, created_at);
CREATE UNIQUE INDEX event_invites_once_per_inviter ON event_invites (event_id, invitee_user_id, invited_by) WHERE invitee_user_id IS NOT NULL;

CREATE TABLE rsvps (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('going', 'interested', 'waitlisted', 'cancelled', 'checked_in')),
  -- Gender bucket snapshot for balanced events (verified gender only; everyone else is 'other').
  gender_bucket text NOT NULL DEFAULT 'other' CHECK (gender_bucket IN ('woman', 'man', 'other')),
  plus_one_of uuid REFERENCES users (id) ON DELETE SET NULL,
  -- Unclaimed guest +1 seat held by this RSVP (0 or 1); the claim token is stored hashed.
  guest_seats integer NOT NULL DEFAULT 0 CHECK (guest_seats IN (0, 1)),
  guest_claim_token_hash text UNIQUE,
  waitlisted_at timestamptz,
  checked_in_at timestamptz,
  check_in_method text CHECK (check_in_method IN ('qr', 'geofence')),
  cancelled_at timestamptz,
  late_cancel boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
CREATE INDEX rsvps_user_idx ON rsvps (user_id, status, event_id);
CREATE INDEX rsvps_event_status_idx ON rsvps (event_id, status);
CREATE INDEX rsvps_waitlist_idx ON rsvps (event_id, waitlisted_at) WHERE status = 'waitlisted';
CREATE TRIGGER rsvps_updated_at BEFORE UPDATE ON rsvps FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE waitlist_offers (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('sequential', 'broadcast')),
  status text NOT NULL CHECK (status IN ('open', 'claimed', 'expired', 'superseded')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX waitlist_offers_one_open ON waitlist_offers (event_id, user_id) WHERE status = 'open';
CREATE INDEX waitlist_offers_expiry_idx ON waitlist_offers (expires_at) WHERE status = 'open';
CREATE INDEX waitlist_offers_event_idx ON waitlist_offers (event_id, user_id, status);
CREATE TRIGGER waitlist_offers_updated_at BEFORE UPDATE ON waitlist_offers FOR EACH ROW EXECUTE FUNCTION set_updated_at();
