-- Phase 10: notification inbox + delivery (quiet hours, batching), reminder bookkeeping, calendar feeds.

-- ---------- F-NOT-01 ----------
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  category text NOT NULL,
  -- Template parameters; text is rendered in the reader's language when read.
  params jsonb NOT NULL DEFAULT '{}',
  path text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_inbox_idx ON notifications (user_id, created_at DESC, id DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX notifications_retention_idx ON notifications (created_at);

CREATE TABLE notification_settings (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  quiet_enabled boolean NOT NULL DEFAULT true,
  quiet_start smallint NOT NULL DEFAULT 1320 CHECK (quiet_start BETWEEN 0 AND 1439),
  quiet_end smallint NOT NULL DEFAULT 480 CHECK (quiet_end BETWEEN 0 AND 1439),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER notification_settings_updated_at BEFORE UPDATE ON notification_settings FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Pushes held for quiet hours or batching; the worker sends them (several at once become a digest).
CREATE TABLE pending_pushes (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  notification_id uuid REFERENCES notifications (id) ON DELETE SET NULL,
  kind text NOT NULL,
  category text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',
  path text NOT NULL,
  collapse_key text,
  deliver_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pending_pushes_due_idx ON pending_pushes (deliver_after);
CREATE INDEX pending_pushes_user_idx ON pending_pushes (user_id);

-- ---------- F-NOT-02 ----------
-- One row per reminder sent, so jobs can run as often as they like without repeating themselves.
CREATE TABLE reminder_log (
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ref_id uuid NOT NULL,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, ref_id, kind)
);
CREATE INDEX reminder_log_sent_idx ON reminder_log (sent_at);

-- ---------- F-CAL-01 ----------
-- Feed tokens are HMACs of (user, version); bumping the version revokes the old link.
CREATE TABLE calendar_feeds (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER calendar_feeds_updated_at BEFORE UPDATE ON calendar_feeds FOR EACH ROW EXECUTE FUNCTION set_updated_at();
