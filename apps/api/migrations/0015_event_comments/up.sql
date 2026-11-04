-- Phase 13: comments on plans, and the host's group chat switch (D-156).

ALTER TABLE events ADD COLUMN chat_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check
  CHECK (target_type IN ('user', 'event', 'message', 'lore_media', 'story', 'event_comment'));

CREATE TABLE event_comments (
  id uuid PRIMARY KEY DEFAULT uuid_v7(),
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(body) BETWEEN 1 AND 500),
  -- Tripped the text filter: only the author sees it until reviewed (F-SAF-06).
  held_at timestamptz,
  status text NOT NULL DEFAULT 'visible' CHECK (status IN ('visible', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_comments_event_idx ON event_comments (event_id, created_at DESC, id DESC) WHERE status = 'visible';
CREATE INDEX event_comments_author_idx ON event_comments (author_id);
CREATE TRIGGER event_comments_updated_at BEFORE UPDATE ON event_comments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
