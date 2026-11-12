-- Private plans (D-179): anyone can see the basics and ask to join; a host approves or declines each person.
ALTER TABLE events DROP CONSTRAINT events_visibility_check;
ALTER TABLE events ADD CONSTRAINT events_visibility_check
  CHECK (visibility IN ('public', 'friends_of_friends', 'invite_only', 'approval', 'women_only', 'men_only', 'balanced'));

CREATE TABLE event_join_requests (
  event_id uuid NOT NULL REFERENCES events (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  decided_by uuid REFERENCES users (id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);
-- A host's list of people waiting, oldest first.
CREATE INDEX event_join_requests_pending_idx ON event_join_requests (event_id, created_at, user_id) WHERE status = 'pending';
-- A person's own requests (account export and erasure).
CREATE INDEX event_join_requests_user_idx ON event_join_requests (user_id);
CREATE TRIGGER event_join_requests_updated_at BEFORE UPDATE ON event_join_requests FOR EACH ROW EXECUTE FUNCTION set_updated_at();
