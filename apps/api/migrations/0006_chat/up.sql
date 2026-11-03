-- Phase 5: chat (DMs, event chats, crew chats later), polls, icebreakers, find-your-group signals, newcomer welcomes.

-- Creates the monthly partition containing `at` (back-filled history, imports). Idempotent.
CREATE OR REPLACE FUNCTION ensure_monthly_partition_for(parent text, at timestamptz)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE
  m date := date_trunc('month', at AT TIME ZONE 'UTC')::date;
  part text := format('%s_y%sm%s', parent, to_char(m, 'YYYY'), to_char(m, 'MM'));
BEGIN
  IF to_regclass(part) IS NOT NULL THEN
    RETURN false;
  END IF;
  EXECUTE format(
    'CREATE TABLE %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
    part, parent, m::timestamptz, (m + interval '1 month')::timestamptz
  );
  RETURN true;
END;
$$;

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  kind text NOT NULL CHECK (kind IN ('direct', 'event', 'crew')),
  -- One chat per event, one per pair of people (key = lower uuid ':' higher uuid), one per crew (Phase 8).
  event_id uuid UNIQUE REFERENCES events (id) ON DELETE CASCADE,
  crew_id uuid UNIQUE,
  direct_key text UNIQUE,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  last_message_id uuid,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  CHECK ((kind = 'event') = (event_id IS NOT NULL)),
  CHECK ((kind = 'crew') = (crew_id IS NOT NULL))
);
CREATE TRIGGER conversations_updated_at BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- 'request': a DM request this member has not answered yet; 'declined' hides it from them (silently).
  status text NOT NULL CHECK (status IN ('active', 'request', 'declined', 'left')),
  muted_until timestamptz,
  last_read_message_id uuid,
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members (user_id, status);
CREATE TRIGGER conversation_members_updated_at BEFORE UPDATE ON conversation_members FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Messages: monthly range partitions on created_at. Ids are UUID v7 and created_at is the id's own timestamp,
-- so a lookup by id can always name its partition.
CREATE TABLE messages (
  id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_id uuid REFERENCES users (id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'image', 'system', 'poll')),
  body text,
  media_asset_id uuid,
  reply_to_id uuid,
  poll_id uuid,
  system jsonb,
  client_id text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (created_at, id),
  CHECK (kind <> 'text' OR body IS NOT NULL OR deleted_at IS NOT NULL)
) PARTITION BY RANGE (created_at);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX messages_sender_idx ON messages (sender_id, created_at DESC);
SELECT ensure_monthly_partitions('messages', 2);

-- Offline-queue de-duplication: one message per (sender, client id); kept for a week.
CREATE TABLE message_client_ids (
  sender_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id text NOT NULL,
  message_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sender_id, client_id)
);
CREATE INDEX message_client_ids_created_idx ON message_client_ids (created_at);

CREATE TABLE message_reactions (
  message_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id, emoji)
);

-- "Delete for me".
CREATE TABLE message_hidden (
  message_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, message_id)
);

CREATE TABLE polls (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  conversation_id uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  creator_id uuid REFERENCES users (id) ON DELETE SET NULL,
  question text NOT NULL,
  multi boolean NOT NULL DEFAULT false,
  anonymous boolean NOT NULL DEFAULT false,
  closes_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX polls_conversation_idx ON polls (conversation_id);
CREATE INDEX polls_to_close_idx ON polls (closes_at) WHERE closed_at IS NULL AND closes_at IS NOT NULL;
CREATE TRIGGER polls_updated_at BEFORE UPDATE ON polls FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE poll_options (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  poll_id uuid NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  text text NOT NULL,
  position integer NOT NULL,
  UNIQUE (poll_id, position)
);

CREATE TABLE poll_votes (
  poll_id uuid NOT NULL REFERENCES polls (id) ON DELETE CASCADE,
  option_id uuid NOT NULL REFERENCES poll_options (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, option_id, user_id)
);
CREATE INDEX poll_votes_user_idx ON poll_votes (poll_id, user_id);

-- Icebreaker deck (admin-managed) and host pushes to attendees' screens.
CREATE TABLE icebreaker_cards (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  prompt jsonb NOT NULL CHECK (prompt ? 'en' AND prompt ? 'te' AND prompt ? 'hi'),
  category text NOT NULL CHECK (category IN ('light', 'deep', 'playful', 'local')),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX icebreaker_cards_active_idx ON icebreaker_cards (sort_order, id) WHERE active;
CREATE TRIGGER icebreaker_cards_updated_at BEFORE UPDATE ON icebreaker_cards FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE event_icebreaker_pushes (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  card_id uuid NOT NULL REFERENCES icebreaker_cards (id),
  pushed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  pushed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_icebreaker_pushes_event_idx ON event_icebreaker_pushes (event_id, pushed_at DESC);

-- Find-your-group: colour + icon per plan, unique among plans overlapping in time nearby.
CREATE TABLE event_signals (
  event_id uuid PRIMARY KEY REFERENCES events (id) ON DELETE CASCADE,
  color text NOT NULL,
  icon text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE newcomer_welcomes (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  welcomed_by uuid REFERENCES users (id) ON DELETE SET NULL,
  welcomed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
